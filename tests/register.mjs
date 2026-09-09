import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

// The plugin bundler accepts extensionless TypeScript imports; mirror that
// resolution when running the same source with Node's native type stripping.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      if (!/\.[a-z]+$/i.test(url.pathname) && existsSync(new URL(`${url}.ts`))) {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
