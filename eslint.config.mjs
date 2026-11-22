import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // mobile/** is the Expo companion (its own toolchain: metro, babel,
    // expo lint); the host's Next-flavored ESLint must not lint it.
    ignores: [".next/**", "node_modules/**", "prisma/migrations/**", "mobile/**"],
  },
];

export default eslintConfig;
