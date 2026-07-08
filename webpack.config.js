const webpack = require("webpack");
const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = function (_env, argv) {
  const mode = argv?.mode || "development";

  return {
    devtool: "source-map",
    mode,
    target: "web",
    entry: {
      renderer: "./src/renderer.tsx",
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    output: {
      path: path.resolve(__dirname, "dist-tauri"),
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
          use: [MiniCssExtractPlugin.loader, "css-loader", "less-loader"],
        },
        {
          test: /\.scss$/,
          use: [MiniCssExtractPlugin.loader, "css-loader", "resolve-url-loader", "sass-loader"],
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, "css-loader"],
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
        "process.env.NODE_ENV": JSON.stringify(mode),
      }),
      new MiniCssExtractPlugin({
        filename: "[name].css",
      }),
    ],
    devServer: {
      static: path.resolve(__dirname, "dist-tauri"),
      port: 5181,
      hot: false,
      liveReload: true,
    },
  };
};
