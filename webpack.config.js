const webpack = require("webpack");
const merge = require("webpack-merge");
const resolve = require("path").resolve;
const shortid  = require("shortid");

var config = {
  devtool: "cheap-module-source-map",
  entry: {
    background: "./src/background",
    contentscript: "./src/contentscript",
    external: "./src/external",
    popup: "./src/popup",
    vendor: ["rxjs", "jquery", "lodash", "bluebird", "socket.io-client"]
  },
  output: {
    filename: "[name].js",
    sourceMapFilename: "[name].js.map",
    path: resolve(__dirname, "extension/dist"),
  },
  module: {
    rules: [{
      test: /\.js$/, 
      use: "babel-loader",
      include: [
        resolve(__dirname, "src")
      ],
      exclude: [
        resolve(__dirname, "node_modules")
      ]
    }]
  },
  plugins: [
    new webpack.DefinePlugin({
      "EXTERNAL_TOKEN": JSON.stringify(shortid.generate())
    }),
    new webpack.optimize.CommonsChunkPlugin({
      name: "vendor"
    })
  ]
};

if (process.env.NODE_ENV === "production") {
  config = merge(config, {
    plugins: [
      new webpack.LoaderOptionsPlugin({
        minimize: true,
        debug: false
      }),
      new webpack.DefinePlugin({
        "process.env": {
          "NODE_ENV": JSON.stringify("production")
        }
      }),
      new webpack.optimize.UglifyJsPlugin({
        beautify: false,
        sourceMap: true,
        mangle: {
          screw_ie8: true,
          keep_fnames: true
        },
        compress: {
          screw_ie8: true,
          warnings: false
        },
        comments: false
      })
    ]
  });
}

module.exports = config;
