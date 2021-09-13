const webpack = require('webpack');
module.exports = {
    entry: './gui/Root.js', // entry pointを起点にバンドルしていきます
    target: 'electron-renderer',
    output: { // 出力に関して
        filename: 'bundle.js', // 出力するファイル名    
        path: `${__dirname}/output/` // 出力するディレクトリ階層
        // pathは絶対パスで指定、そのため __dirname でディレクトリ階層を取得しています
    },
    plugins: [
        new webpack.IgnorePlugin(/electron/),
    ],
    
};