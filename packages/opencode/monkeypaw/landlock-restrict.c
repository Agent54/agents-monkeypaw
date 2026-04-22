/*
 * landlock-restrict.c
 *
 * Reads colon-separated paths from:
 *   LANDLOCK_RX - read + execute
 *   LANDLOCK_RO - read-only
 *   LANDLOCK_RW - read-write
 *
 * Modes:
 *   --check  Print the ABI version if Landlock is usable.
 *   COMMAND  Apply the ruleset and exec the command.
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#define EXIT_UNSUPPORTED 2
#define EXIT_BLOCKED 3

#ifndef landlock_create_ruleset
static inline int
landlock_create_ruleset(const struct landlock_ruleset_attr *attr, size_t size,
                        __u32 flags)
{
    return (int)syscall(__NR_landlock_create_ruleset, attr, size, flags);
}
#endif

#ifndef landlock_add_rule
static inline int
landlock_add_rule(int ruleset_fd, enum landlock_rule_type type,
                  const void *attr, __u32 flags)
{
    return (int)syscall(__NR_landlock_add_rule, ruleset_fd, type, attr, flags);
}
#endif

#ifndef landlock_restrict_self
static inline int landlock_restrict_self(int ruleset_fd, __u32 flags)
{
    return (int)syscall(__NR_landlock_restrict_self, ruleset_fd, flags);
}
#endif

static __u64 fs_ro_access(void)
{
    return LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
}

static __u64 fs_rx_access(void)
{
    return fs_ro_access() | LANDLOCK_ACCESS_FS_EXECUTE;
}

static __u64 fs_rw_access(int abi)
{
    __u64 access = fs_ro_access() | LANDLOCK_ACCESS_FS_WRITE_FILE |
                    LANDLOCK_ACCESS_FS_REMOVE_FILE |
                    LANDLOCK_ACCESS_FS_REMOVE_DIR |
                    LANDLOCK_ACCESS_FS_MAKE_CHAR |
                    LANDLOCK_ACCESS_FS_MAKE_DIR |
                    LANDLOCK_ACCESS_FS_MAKE_REG |
                    LANDLOCK_ACCESS_FS_MAKE_SOCK |
                    LANDLOCK_ACCESS_FS_MAKE_FIFO |
                    LANDLOCK_ACCESS_FS_MAKE_BLOCK |
                    LANDLOCK_ACCESS_FS_MAKE_SYM;

    if (abi >= 2)
        access |= LANDLOCK_ACCESS_FS_REFER;
    if (abi >= 3)
        access |= LANDLOCK_ACCESS_FS_TRUNCATE;
    return access;
}

static __u64 handled_access(int abi)
{
    return fs_rx_access() | fs_rw_access(abi);
}

static int probe_abi(void)
{
    int abi = landlock_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi >= 0)
        return abi;

    if (errno == EPERM) {
        fprintf(stderr,
                "[landlock] syscall blocked (EPERM); seccomp or container policy "
                "is preventing Landlock\n");
        return -EXIT_BLOCKED;
    }

    fprintf(stderr, "[landlock] unsupported or disabled (errno=%d: %s)\n",
            errno, strerror(errno));
    return -EXIT_UNSUPPORTED;
}

static __u64 path_access(int fd, __u64 access)
{
    struct stat statbuf;
    if (fstat(fd, &statbuf) != 0)
        return access;

    if (S_ISDIR(statbuf.st_mode))
        return access;

    return access & (LANDLOCK_ACCESS_FS_READ_FILE |
                     LANDLOCK_ACCESS_FS_WRITE_FILE |
                     LANDLOCK_ACCESS_FS_EXECUTE |
                     LANDLOCK_ACCESS_FS_TRUNCATE);
}

static int add_path_rule(int ruleset_fd, const char *path, __u64 access)
{
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) {
        fprintf(stderr, "[landlock] failed to open '%s': %s\n", path,
                strerror(errno));
        return -1;
    }

    struct landlock_path_beneath_attr attr = {
        .allowed_access = path_access(fd, access),
        .parent_fd = fd,
    };

    int ret = landlock_add_rule(ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, &attr,
                                0);
    close(fd);
    if (ret == 0)
        return 1;

    fprintf(stderr, "[landlock] failed to add rule for '%s': %s\n", path,
            strerror(errno));
    return -1;
}

static int add_paths_from_env(int ruleset_fd, const char *envvar, __u64 access)
{
    const char *value = getenv(envvar);
    if (!value || !*value)
        return 0;

    char *buffer = strdup(value);
    if (!buffer) {
        perror("[landlock] strdup");
        return -1;
    }

    int count = 0;
    char *saveptr = NULL;
    for (char *token = strtok_r(buffer, ":", &saveptr); token;
         token = strtok_r(NULL, ":", &saveptr)) {
        int added = add_path_rule(ruleset_fd, token, access);
        if (added < 0) {
            free(buffer);
            return -1;
        }
        count += added;
    }

    free(buffer);
    return count;
}

int main(int argc, char *argv[])
{
    if (argc == 2 && strcmp(argv[1], "--check") == 0) {
        int abi = probe_abi();
        if (abi < 0)
            return -abi;
        printf("%d\n", abi);
        return 0;
    }

    if (argc < 2) {
        fprintf(stderr, "Usage: landlock-restrict [--check] COMMAND [ARGS...]\n");
        return 1;
    }

    int abi = probe_abi();
    if (abi < 0)
        return -abi;

    struct landlock_ruleset_attr ruleset_attr = {
        .handled_access_fs = handled_access(abi),
    };

    int ruleset_fd =
        landlock_create_ruleset(&ruleset_attr, sizeof(ruleset_attr), 0);
    if (ruleset_fd < 0) {
        if (errno == EPERM) {
            fprintf(stderr,
                    "[landlock] create_ruleset blocked (EPERM); seccomp or "
                    "container policy is preventing Landlock\n");
            return EXIT_BLOCKED;
        }
        fprintf(stderr, "[landlock] create_ruleset failed: %s\n",
                strerror(errno));
        return 1;
    }

    int rules = 0;
    int added = add_paths_from_env(ruleset_fd, "LANDLOCK_RX", fs_rx_access());
    if (added < 0) {
        close(ruleset_fd);
        return 1;
    }
    rules += added;

    added = add_paths_from_env(ruleset_fd, "LANDLOCK_RO", fs_ro_access());
    if (added < 0) {
        close(ruleset_fd);
        return 1;
    }
    rules += added;

    added = add_paths_from_env(ruleset_fd, "LANDLOCK_RW", fs_rw_access(abi));
    if (added < 0) {
        close(ruleset_fd);
        return 1;
    }
    rules += added;

    if (rules == 0) {
        fprintf(stderr, "[landlock] refusing to apply an empty ruleset\n");
        close(ruleset_fd);
        return 1;
    }

    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) {
        fprintf(stderr, "[landlock] PR_SET_NO_NEW_PRIVS failed: %s\n",
                strerror(errno));
        close(ruleset_fd);
        return 1;
    }

    if (landlock_restrict_self(ruleset_fd, 0)) {
        if (errno == EPERM) {
            fprintf(stderr,
                    "[landlock] restrict_self blocked (EPERM); seccomp or "
                    "container policy is preventing Landlock\n");
            close(ruleset_fd);
            return EXIT_BLOCKED;
        }
        fprintf(stderr, "[landlock] restrict_self failed: %s\n",
                strerror(errno));
        close(ruleset_fd);
        return 1;
    }

    close(ruleset_fd);
    execvp(argv[1], &argv[1]);
    perror("execvp");
    return 1;
}
