using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "proxy", worker = .proxyWorker),
    (
      name = "internet",
      network = (
        allow = ["public", "private"],
        tlsOptions = (trustBrowserCas = true),
      ),
    ),
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
    (
      name = "httpProxy",
      tcp = (),
      service = (name = "proxy", entrypoint = "proxy"),
    ),
    (
      name = "httpsProxy",
      tcp = (
        tlsOptions = (
          keypair = (
            privateKey = embed "workerd-proxy-key.pem",
            certificateChain = embed "workerd-proxy-cert.pem",
          ),
        ),
      ),
      service = (name = "proxy", entrypoint = "proxy"),
    ),
    (
      name = "agentHttp",
      http = (),
      service = (name = "proxy", entrypoint = "agent"),
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
