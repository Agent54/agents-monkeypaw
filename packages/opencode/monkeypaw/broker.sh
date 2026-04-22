npx workerd serve "$PWD/permission-broker.workerd.capnp" config \
  --experimental --socket-addr permissionBroker="unix:$PWD/permission-broker.sock"
