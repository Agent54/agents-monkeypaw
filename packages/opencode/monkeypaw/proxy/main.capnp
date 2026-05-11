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
      service = (name = "proxy", entrypoint = "proxy"),
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
    (
      name = "permissionUi",
      http = (),
      service = (name = "proxy", entrypoint = "permissionUi"),
    ),
  ],
);

const proxyWorker :Workerd.Worker = (
  bindings = [
    (
      name = "EVENT_BUS",
      durableObjectNamespace = "EventBus",
    ),
  ],
  durableObjectNamespaces = [
    (
      className = "EventBus",
      uniqueKey = "opencode-monkeypaw-proxy-event-bus-v1",
      preventEviction = true,
    ),
  ],
  durableObjectStorage = (inMemory = void),
  modules = [
    (
      name = "main",
      esModule = embed "main.js",
    ),
    (
      name = "ui.js",
      esModule = embed "ui.js",
    ),
    (
      name = "client.js",
      text = embed "client.js",
    ),
  ],
  compatibilityFlags = ["nodejs_compat_v2", "experimental"],
  compatibilityDate = "2026-04-23",
);
