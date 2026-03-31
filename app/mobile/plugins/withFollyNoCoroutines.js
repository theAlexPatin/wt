const { withPodfile } = require("expo/config-plugins");

module.exports = function withFollyNoCoroutines(config) {
  return withPodfile(config, (config) => {
    const postInstallHook = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        defs = bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
        defs << 'FOLLY_CFG_NO_COROUTINES=1' unless defs.include?('FOLLY_CFG_NO_COROUTINES=1')
      end
    end`;

    // Insert the folly fix before the closing of post_install
    config.modResults.contents = config.modResults.contents.replace(
      /post_install do \|installer\|/,
      `post_install do |installer|${postInstallHook}`
    );

    return config;
  });
};
