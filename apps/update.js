import { update as Update } from "../../other/update.js"

export class LinuxDoUpdate extends plugin {
  constructor() {
    super({
      name: "linuxdo-plugin更新",
      dsc: "#linuxdo更新 #linuxdo强制更新",
      event: "message",
      priority: 1000,
      rule: [
        { reg: /^#?(linuxdo|linux\.do|LinuxDo)(强制)?更新$/, fnc: "update", permission: "master" }
      ]
    })
  }

  async update(e = this.e) {
    e.isMaster = true
    e.msg = `#${e.msg.includes("强制") ? "强制" : ""}更新linuxdo-plugin`
    const up = new Update(e)
    up.e = e
    return up.update()
  }
}
