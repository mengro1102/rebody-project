// babel-preset-expo가 expo-router와 tsconfig의 @/* 별칭(experiments.tsconfigPaths)을 함께 처리한다.
// 별도 module-resolver 플러그인을 추가하지 않는다 — 두 경로 해석기가 공존하면 어긋난다.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
