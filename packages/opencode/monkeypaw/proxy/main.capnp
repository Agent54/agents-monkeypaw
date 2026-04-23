using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "proxy", worker = .proxyWorker),
  ],

  sockets = [
    (
      name = "internalBroker",
      tcp = (),
      service = (name = "proxy", entrypoint = "permissionBroker"),
    ),
    (
      name = "externalHttp",
      http = (),
      service = (name = "proxy", entrypoint = "debugHttp"),
    ),
  ],
);

const proxyWorker :Workerd.Worker = (
  modules = [
    (
      name = "main",
      esModule = embed "main.js",
    ),
  ],
  compatibilityFlags = ["nodejs_compat_v2", "experimental"],
  compatibilityDate = "2026-04-23",
);
