/* 
 * landlock-restrict.c — Minimal Landlock filesystem restriction helper
 *
 * Reads colon-separated paths from environment variables:
 *   LANDLOCK_RX — read + execute access
 *   LANDLOCK_RO — read-only access
 *   LANDLOCK_RW — read-write access
 *
 * Then exec's the remaining argv.
 *
 * Build: gcc -static -o landlock-restrict landlock-restrict.c
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

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

#define ACCESS_FS_RO                                                           \
    (LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR |              \
     LANDLOCK_ACCESS_FS_REFER)

#define ACCESS_FS_RX                                                           \
    (ACCESS_FS_RO | LANDLOCK_ACCESS_FS_EXECUTE)

#define ACCESS_FS_RW                                                           \
    (ACCESS_FS_RO | LANDLOCK_ACCESS_FS_WRITE_FILE |                            \
     LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR |          \
     LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR |             \
     LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK |             \
     LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |           \
     LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_TRUNCATE)

static int add_path_rule(int ruleset_fd, const char *path, __u64 access)
{
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) {
        fprintf(stderr, "[landlock] WARNING: cannot open '%s': %s\n", path,
                strerror(errno));
        return 0; /* non-fatal: path may not exist */
    }

    struct landlock_path_beneath_attr attr = {
        .allowed_access = access,
        .parent_fd = fd,
    };

    int ret = landlock_add_rule(ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, &attr,
                                0);
    close(fd);
    if (ret) {
        fprintf(stderr, "[landlock] WARNING: add_rule failed for '%s': %s\n",
                path, strerror(errno));
    }
    return ret;
}

static void add_paths_from_env(int ruleset_fd, const char *envvar,
                               __u64 access)
{
    const char *val = getenv(envvar);
    if (!val || !*val)
        return;

    char *buf = strdup(val);
    char *tok = strtok(buf, ":");
    while (tok) {
        add_path_rule(ruleset_fd, tok, access);
        tok = strtok(NULL, ":");
    }
    free(buf);
}

int main(int argc, char *argv[])
{
    if (argc < 2) {
        fprintf(stderr, "Usage: landlock-restrict COMMAND [ARGS...]\n");
        return 1;
    }

    /* Check ABI */
    int abi = landlock_create_ruleset(NULL, 0,
                                      LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 0) {
        fprintf(stderr,
                "[landlock] Kernel does not support Landlock (errno=%d), "
                "running unrestricted\n",
                errno);
        execvp(argv[1], &argv[1]);
        perror("execvp");
        return 1;
    }
    fprintf(stderr, "[landlock] ABI version %d\n", abi);

    /* Create ruleset */
    struct landlock_ruleset_attr ruleset_attr = {
        .handled_access_fs = ACCESS_FS_RW | LANDLOCK_ACCESS_FS_EXECUTE,
    };

    int ruleset_fd =
        landlock_create_ruleset(&ruleset_attr, sizeof(ruleset_attr), 0);
    if (ruleset_fd < 0) {
        perror("[landlock] create_ruleset");
        return 1;
    }

    /* Add rules from environment */
    add_paths_from_env(ruleset_fd, "LANDLOCK_RX", ACCESS_FS_RX);
    add_paths_from_env(ruleset_fd, "LANDLOCK_RO", ACCESS_FS_RO);
    add_paths_from_env(ruleset_fd, "LANDLOCK_RW",
                       ACCESS_FS_RW | LANDLOCK_ACCESS_FS_EXECUTE);

    /* Enforce */
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) {
        perror("[landlock] prctl(NO_NEW_PRIVS)");
        close(ruleset_fd);
        return 1;
    }

    if (landlock_restrict_self(ruleset_fd, 0)) {
        perror("[landlock] restrict_self");
        close(ruleset_fd);
        return 1;
    }

    close(ruleset_fd);
    fprintf(stderr, "[landlock] Filesystem restrictions active\n");

    /* Exec the target */
    execvp(argv[1], &argv[1]);
    perror("execvp");
    return 1;
}
