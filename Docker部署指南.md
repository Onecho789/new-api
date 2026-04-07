# Docker 部署指南

## 镜像仓库信息

| 项目 | 值 |
|------|------|
| 仓库地址 | `crpi-5crzt6re0fxdstja.cn-beijing.personal.cr.aliyuncs.com/echoapi/new-api` |
| 用户名 | `louhuanhao` |
| 密码 | `hao17661041315` |

## 本地构建并推送

每次构建必须同时打 **版本号 tag** 和 **latest tag**，保留历史版本便于回滚。

版本号跟随 git tag（`git tag --sort=-v:refname | head -1` 查看最新版本）。

```bash
# 1. 登录阿里云镜像仓库
echo "hao17661041315" | docker login --username=louhuanhao --password-stdin crpi-5crzt6re0fxdstja.cn-beijing.personal.cr.aliyuncs.com

# 2. 查看当前最新版本号
git tag --sort=-v:refname | head -1

# 3. 构建镜像（同时打版本号 tag 和 latest tag）
#    将 <VERSION> 替换为实际版本号，如 v0.12.0-alpha.2
docker build \
  -t crpi-5crzt6re0fxdstja.cn-beijing.personal.cr.aliyuncs.com/echoapi/new-api:<VERSION> \
  -t crpi-5crzt6re0fxdstja.cn-beijing.personal.cr.aliyuncs.com/echoapi/new-api:latest \
  .

# 4. 推送两个 tag
docker push crpi-5crzt6re0fxdstja.cn-beijing.personal.cr.aliyuncs.com/echoapi/new-api:<VERSION>
docker push crpi-5crzt6re0fxdstja.cn-beijing.personal.cr.aliyuncs.com/echoapi/new-api:latest
```

## 服务器更新

```bash
docker-compose pull && docker-compose up -d
```

## 回滚到历史版本

```bash
# 修改 docker-compose.yml 中的 image tag 为目标版本号，然后：
docker-compose pull && docker-compose up -d
```
