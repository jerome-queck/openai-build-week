module.exports = {
  packagerConfig: {
    asar: true,
    icon: undefined,
    osxSign: {
      identity: "-",
      identityValidation: false,
      optionsForFile: () => ({ hardenedRuntime: false }),
      continueOnError: false
    },
    ignore: [
      /^\/src($|\/)/,
      /^\/tests($|\/)/,
      /^\/docs($|\/)/,
      /^\/prototype($|\/)/,
      /^\/.agents($|\/)/,
      /^\/.claude($|\/)/,
      /^\/.github($|\/)/,
      /^\/out($|\/)/
    ]
  },
  makers: []
};
