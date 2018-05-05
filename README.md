# Qiniu Webpack Plugin [![npm](https://img.shields.io/npm/v/better-qiniu-webpack-plugin.svg)](https://www.npmjs.com/package/better-qiniu-webpack-plugin)

> 🚀 Webpack 编译后的文件上传到 七牛云存储

## 功能

- 支持并发上传
- 保留上一版本文件
- 智能分析，不重复上传

## 安装

```Bash
yarn add better-qiniu-webpack-plugin --dev
```


## 使用

**webpack.config.js**

```Javascript
const QiniuWebpackPlugin = require('better-qiniu-webpack-plugin');

module.exports = {
  // ... Webpack 相关配置
  plugins: [
    new QiniuWebpackPlugin()
  ]
}
```

在项目目录下新建 `.qiniu_webpack` 文件，并且在 `.gitignore` 忽略此文件

**.qiniu_webpack**

```Javascript
module.exports = {
  accessKey: 'qiniu access key', // required
  secretKey: 'qiniu secret key', // required
  bucket: 'demo', // required
  bucketDomain: 'https://domain.bkt.clouddn.com', // required
  matchFiles: ['!*.html', '!*.map'],
  uploadPath: '/assets',
  batch: 10
}
```

**Options**

|Name|Type|Default|Required|Description|
|:--:|:--:|:-----:|:-----:|:----------|
|**[`accessKey`](#)**|`{String}`| | true |七牛 Access Key|
|**[`secretKey`](#)**|`{String}`| | true |七牛 Secret Key|
|**[`bucket`](#)**|`{String}`| | true |七牛 空间名|
|**[`bucketDomain`](#)**|`{String}`| | true |七牛 空间域名|
|**[`matchFiles`](#)**|`{Array[string]}`| ['*'] | false |匹配文件/文件夹，支持 include/exclude|
|**[`uploadPath`](#)**|`{string}`| /webpack_assets | false |上传文件夹名|
|**[`batch`](#)**|`{number}`| 10 | false |同时上传文件数|

- `bucketDomain` 支持不携带通信协议: `//domain.bkt.clouddn.com`
- `matchFiles` 匹配相关文件或文件夹，详细使用请看: [micromatch](https://github.com/micromatch/micromatch)
  - `!*.html` 不上传文件后缀为 `html` 的文件
  - `!assets/**.map` 不上传 `assets` 文件夹下文件后缀为 `map` 的文件



***


## License

Copyright © 2018, [zzetao](https://github.com/zzetao).
Released under the [MIT License](LICENSE).
