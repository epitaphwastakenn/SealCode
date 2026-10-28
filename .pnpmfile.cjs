// Windows installs need Linux x64 glibc binaries because WSL shares node_modules.
// Keep other platforms native; release scripts set their own architectures.
module.exports = {
  hooks: {
    // `typescript` is @tsc-rs/typescript (the catalog entry). Its npm version (0.8.x) is outside
    // vite-plus-core's typescript peer range, so pnpm could give the vite-plus that @effect/vitest
    // imports another workspace's typescript, and tests would load a second vitest.
    readPackage(pkg) {
      if (pkg.name === "@voidzero-dev/vite-plus-core" && pkg.peerDependencies?.typescript) {
        pkg.peerDependencies.typescript = "*";
      }
      // The web voice preview only uses the browser build. onnxruntime-node alone unpacks ~300 MB
      // of native binaries per install and would never be loaded.
      if (pkg.name === "@huggingface/transformers" && pkg.dependencies) {
        delete pkg.dependencies["onnxruntime-node"];
        delete pkg.dependencies.sharp;
      }
      return pkg;
    },
    updateConfig(config) {
      // oxlint-disable-next-line t3code/no-global-process-runtime -- pnpm loads this file before any Effect runtime exists.
      if (process.platform !== "win32") return config;
      return {
        ...config,
        supportedArchitectures: {
          os: ["current", "linux"],
          cpu: ["current", "x64"],
          libc: ["current", "glibc"],
        },
      };
    },
  },
};
