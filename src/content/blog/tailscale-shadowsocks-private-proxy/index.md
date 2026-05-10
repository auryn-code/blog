---
title: 基于 Tailscale 搭建私有 Shadowsocks 节点
publishDate: 2026-05-11 11:00:00
description: 在 LA 服务器上部署 Shadowsocks，并用 UFW 限制仅允许 Tailscale 组网设备访问。
tags:
  - tailscale
  - shadowsocks
  - network
  - security
language: 'Chinese'
comment: true
---

这篇记录一下我在 LA 服务器上搭建私有 Shadowsocks 节点的过程。

核心思路很简单：Shadowsocks 本身只负责代理服务，真正的访问控制交给 Tailscale 和防火墙完成。服务端监听所有地址，但防火墙只允许来自 `tailscale0` 网卡的流量访问代理端口。这样公网不会暴露 Shadowsocks 端口，只有已经加入同一个 Tailscale 网络的设备才能连上。

适用场景是个人设备之间的私有访问。请遵守所在地法律法规和服务商条款。

## 架构思路

最终结构大概是这样：

```text
客户端设备
  -> Tailscale 内网
  -> LA 服务器 tailscale0
  -> Shadowsocks-libev :8388
```

公网侧只保留 SSH 等必要入口，`8388` 不直接对公网开放。客户端配置里填写的服务器地址也不是公网 IP，而是 Tailscale 分配的 `100.x.y.z` 内网 IPv4 地址。

## 一、接入 Tailscale

先把服务器加入自己的 Tailscale 网络。

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

执行 `tailscale up` 后，终端会输出一个授权链接。复制到浏览器打开，登录并授权这台服务器。

授权完成后查看服务器的 Tailscale 地址：

```bash
tailscale ip
```

通常会看到一个 `100.` 开头的 IPv4 地址，也可能同时看到 IPv6。后续客户端建议优先使用这个 `100.x.y.z` 的 IPv4 地址，兼容性会更稳。

## 二、安装 Shadowsocks-libev

这里使用轻量的 `shadowsocks-libev`，并选择 AEAD 加密方式。

```bash
sudo apt update
sudo apt install -y shadowsocks-libev
```

编辑配置文件：

```bash
sudo nano /etc/shadowsocks-libev/config.json
```

清空原内容，写入下面的配置。记得把 `你的强密码` 换成自己的高强度密码。

```json
{
  "server": ["::", "0.0.0.0"],
  "server_port": 8388,
  "password": "你的强密码",
  "timeout": 300,
  "method": "aes-256-gcm",
  "nameserver": "8.8.8.8",
  "mode": "tcp_and_udp"
}
```

这里的 `"server": ["::", "0.0.0.0"]` 表示监听 IPv6 和 IPv4 的所有接口。这个配置本身看起来比较开放，但真正的安全边界会在下一步通过 UFW 限制。

配置完成后重启服务：

```bash
sudo systemctl restart shadowsocks-libev
sudo systemctl enable shadowsocks-libev
sudo systemctl status shadowsocks-libev
```

如果状态是 `active (running)`，说明服务已经起来了。

## 三、用 UFW 限制访问来源

这是最关键的一步：只允许从 `tailscale0` 进来的流量访问 `8388` 端口。

如果你是通过 SSH 远程操作服务器，一定要先放行 SSH，再启用防火墙，避免把自己锁在门外。

```bash
sudo ufw reset
sudo ufw default deny incoming
sudo ufw default allow outgoing

sudo ufw allow ssh
```

如果你的 SSH 使用的不是默认 `22` 端口，改成类似下面这种写法：

```bash
sudo ufw allow 2222/tcp
```

如果服务器上还有 Web 服务，再按需放行：

```bash
sudo ufw allow 80
sudo ufw allow 443
```

然后添加 Shadowsocks 的访问规则：

```bash
sudo ufw allow in on tailscale0 to any port 8388
```

最后启用防火墙：

```bash
sudo ufw enable
sudo ufw status
```

期望能看到类似下面的规则：

```text
8388                       ALLOW IN    Anywhere on tailscale0
22/tcp                     ALLOW IN    Anywhere
```

这表示 `8388` 只接受从 Tailscale 网卡进入的连接。公网 IP 访问这个端口会被拒绝。

## 四、做一些网络优化

跨国线路叠加 Tailscale 隧道后，速度瓶颈经常不在 Shadowsocks，而在 UDP 隧道、运营商 QoS 或 MTU。

先开启 BBR：

```bash
echo "net.core.default_qdisc=fq" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

再把 `tailscale0` 的 MTU 调低一些：

```bash
sudo ip link set dev tailscale0 mtu 1280
```

Tailscale 本身会增加额外包头。如果底层网络对分片不友好，默认 MTU 可能导致速度异常低，甚至表现为连接时断时续。`1280` 是一个相对保守的值，通常能绕开不少奇怪的跨网问题。

需要注意的是，直接用 `ip link set` 修改 MTU 重启后可能失效。如果确认这个值确实有帮助，再考虑写进 systemd-networkd、NetworkManager dispatcher，或者用系统启动脚本持久化。

## 五、客户端配置

客户端可以使用 v2rayN、Shadowsocks-Windows、Clash 等常见工具。关键是不要把它配成带伪装、插件或 TLS 的复杂模式。

| 配置项 | 值 |
| --- | --- |
| 服务器地址 | Tailscale IPv4 地址，例如 `100.x.y.z` |
| 端口 | `8388` |
| 密码 | 服务端配置里的强密码 |
| 加密方式 | `aes-256-gcm` |
| 插件 / 伪装 | 留空、None、无 |

最容易踩的坑是客户端打开了 HTTP、TLS、WebSocket 之类的伪装选项。服务端没有配置插件时，客户端也必须保持插件为空。否则看起来像是节点在线，但测试延迟会是 `-1` 或直接超时。

## 六、排查方法

如果客户端连不上，先按下面顺序检查。

### 1. 确认 Tailscale 能互通

在客户端机器上 ping 服务器的 Tailscale 地址：

```bash
ping 100.x.y.z
```

如果这里不通，问题不在 Shadowsocks，而在 Tailscale 组网、登录状态或 ACL。

也可以运行：

```bash
tailscale ping 100.x.y.z
```

如果结果显示 `via DERP`，说明流量走了 Tailscale 中继，速度通常会明显下降。如果显示 `via IP:Port`，说明是点对点直连。

### 2. 确认服务端正在监听

在服务器上检查 Shadowsocks 状态：

```bash
sudo systemctl status shadowsocks-libev
```

如果服务没有运行，先看日志：

```bash
sudo journalctl -u shadowsocks-libev -n 100 --no-pager
```

常见问题包括 JSON 格式错误、密码字段写错、端口被其他程序占用。

### 3. 确认防火墙规则正确

```bash
sudo ufw status verbose
```

重点看有没有这一条：

```text
8388 ALLOW IN on tailscale0
```

如果没有，重新执行：

```bash
sudo ufw allow in on tailscale0 to any port 8388
```

### 4. 排除运营商对 Tailscale UDP 的影响

如果能连上但速度只有 `0.5 MB/s` 左右，常见原因有两个：

第一，Tailscale 没有直连，而是走了 DERP 中继。

第二，跨国 UDP 被运营商限速或丢包。Tailscale 底层主要依赖 UDP，如果晚高峰质量明显下降，这个问题会更突出。

可以做一个临时对照实验：

```bash
sudo ufw allow 8388
```

然后把客户端地址改成服务器公网 IP 测速。如果公网直连速度明显更快，说明瓶颈大概率在 Tailscale 隧道，而不是 Shadowsocks 配置。

测试完成后记得撤回公网开放规则：

```bash
sudo ufw delete allow 8388
```

## 最后

这个方案的优势是隐蔽和可控：Shadowsocks 端口不暴露在公网，访问权限跟着 Tailscale 设备授权走。缺点也很明确：速度上限取决于 Tailscale 的连接质量，尤其是跨国 UDP 环境。

如果你的网络能稳定打洞直连，这套配置会非常省心。如果长期走 DERP 或被 UDP QoS 卡住，就没必要硬扛，可以考虑公网高位端口直连，或者换更适合当前线路的传输方式。
