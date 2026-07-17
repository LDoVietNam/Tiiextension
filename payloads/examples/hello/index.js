export default async function createHelloPayload() {
  return {
    async run(args = {}) {
      return {
        message: `hello ${args.name || "agent"}`,
        args
      };
    }
  };
}

