const webpack = require("webpack");
const path = require("path");
const nodeExternals = require("webpack-node-externals");

function config(nodeEnv) {
  return {
    devtool: "source-map",
    mode: nodeEnv,
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].bundle.js",
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: "ts-loader",
          exclude: /node_modules/,
        },
        {
          enforce: "pre",
          test: /\.js$/,
          loader: "source-map-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.less$/,
          use: ["style-loader", "css-loader", "less-loader"],
        },
        {
          test: /\.scss$/,
          use: ["style-loader", "css-loader", "resolve-url-loader", "sass-loader"],
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader"],
        },
        {
          test: /\.(jpe?g|png|gif|svg)$/i,
          type: "asset/resource",
        },
        {
          test: /\.(eot|ttf|woff|woff2)$/,
          type: "asset/resource",
          generator: {
            filename: "fonts/[name][ext]",
          },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        "process.env.NODE_ENV": JSON.stringify(nodeEnv),
      }),
    ],
  };
}

// Electron main process bundle
const mainConfig = (env) => ({
  ...config(env),
  target: "electron-main",
  entry: {
    main: "./app/main.ts",
  },
  externalsPresets: { node: true },
  externals: [nodeExternals()],
  node: {
    __dirname: false,
    __filename: false,
  },
});

// Electron preload script bundle
const preloadConfig = (env) => ({
  ...config(env),
  target: "electron-preload",
  entry: {
    preload: "./app/preload.ts",
  },
  externalsPresets: { node: true },
  externals: [nodeExternals()],
  node: {
    __dirname: false,
    __filename: false,
  },
});

// Electron renderer process bundle
const rendererConfig = (env) => ({
  ...config(env),
  target: "electron-renderer",
  entry: {
    renderer: "./src/renderer.tsx",
  },
});

module.exports = function (env, argv) {
  const mode = argv?.mode || "development";
  return [mainConfig(mode), preloadConfig(mode), rendererConfig(mode)];
};
