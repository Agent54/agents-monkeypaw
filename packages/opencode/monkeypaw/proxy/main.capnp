using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "permission-broker", worker = .permissionBroker),
  ],

  sockets = [
    (
      name = "permissionBroker",
      # NOTE:
      # Raw permission-broker traffic is newline-delimited JSON over a unix stream socket.
      # Bind the socket path at runtime with:
      #   --socket-addr permissionBroker=unix:$PWD/permission-broker.sock
      tcp = (),
      service = "permission-broker",
    ),
  ],
);

const permissionBroker :Workerd.Worker = (
  modules = [
    (
      name = "permission-broker.workerd",
      esModule = embed "permission-broker.workerd.js",
    ),
  ],
  compatibilityFlags = ["nodejs_compat_v2", "experimental"],
  compatibilityDate = "2026-04-22",
);
