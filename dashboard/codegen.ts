import type { CodegenConfig } from "@graphql-codegen/cli"

const config: CodegenConfig = {
  schema: "./schema.graphql",
  documents: ["lib/graphql/queries/**/*.ts", "lib/graphql/mutations/**/*.ts"],
  generates: {
    "lib/graphql/__generated__/": {
      preset: "client",
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        scalars: {
          UUID: "string",
          DateTime: "string",
          JSON: "unknown",
        },
      },
    },
  },
  ignoreNoDocuments: true,
}

export default config
