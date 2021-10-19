import * as crypto from 'crypto';
import { App, moment, parseYaml, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

interface ObsidianNotifierSettings {
    dueKey: string;
    interval: number;
}

const DEFAULT_SETTINGS: ObsidianNotifierSettings = {
    dueKey: 'due',
    interval: 1,
}

type ObsidianNotification = {
    id: string,
    at: moment.Moment,
    title: string,
    body: string,
    notified: boolean,
    notification?: Notification,
}

type NotificationMap = {
    [key: string]: {
        [key: string]: ObsidianNotification,
    }
}

export default class MyPlugin extends Plugin {
    settings: ObsidianNotifierSettings;

    registeredNotifications: NotificationMap = {};

    async onload() {
        await this.loadSettings();

        this.registerEvent(this.app.metadataCache.on("resolved", () => {
            this.registerNotifications();
            this.notifyDesktop();
        }));

        this.registerEvent(this.app.vault.on('modify', (e:TFile) => {
            this.registerNotifications(e)
        }));

        this.addSettingTab(new SampleSettingTab(this.app, this));

        // Notification Notifier
        this.registerInterval(window.setInterval(() => {
            this.notifyDesktop();
        }, 1 * 60 * 1000));
    }

    onunload() {
        console.log('unloading plugin');
    }

    async registerNotifications(file?: TFile) {
        let files: TFile[];
        if (file == undefined) {
            files = this.app.vault.getMarkdownFiles()
        } else {
            files = [file]
        }

        files.forEach((file: TFile) => {
            let notifications: ObsidianNotification[] = [];
            this.app.vault.cachedRead(file).then((content: String) => {
                if (content.startsWith("---")) {
                    let lines: String[] = content.split('\n').slice(1)
                    let frontmatter: String[] = [];
                    let line: String = lines.shift();

                    while (line && line != '---') {
                        frontmatter.push(line)
                        line = lines.shift();
                    }

                    let payload = parseYaml(frontmatter.join("\n"))
                    if( payload[this.settings.dueKey] !== undefined) {
                        let at: moment.Moment = moment(payload[this.settings.dueKey]);
                        let id_key: string = this.app.vault.getName() + at.toISOString()
                        let id: string = crypto.createHash("sha1").update(id_key).digest("hex");
                        let notification: ObsidianNotification = {
                            id: id,
                            at: at,
                            title: payload.title || file.basename,
                            body: payload.body || "Notification from " + file.basename,
                            notified: false,
                        }

                        if (this.registeredNotifications[file.path] != undefined) {
                            let existing_notification = this.registeredNotifications[file.path][id]
                            if (existing_notification && existing_notification.notified != undefined) {
                                notification.notified = existing_notification.notified
                            }
                        }

                        notifications.push(notification)
                    }
                }

                notifications.forEach((n: ObsidianNotification) => {
                    this.registeredNotifications[file.path] = {}
                    this.registeredNotifications[file.path][n.id] = n
                })
            })
            console.log(this.registeredNotifications)
        })
    }

    async notifyDesktop() {
        let now = moment.now();
        let files = this.app.vault.getMarkdownFiles()
        console.log(files)

        for (const file of this.app.vault.getMarkdownFiles()) {
            console.log(this.registeredNotifications)
            if (Object.prototype.hasOwnProperty.call(this.registeredNotifications, file.path)) {
                const actionable = Object.keys(this.registeredNotifications[file.path]).filter((n_key: string) => {
                    let notification: ObsidianNotification = this.registeredNotifications[file.path][n_key];
                    return !notification.notified && notification.at.isBefore(now);
                });

                actionable.forEach((n_key: string) => {
                    let notification: ObsidianNotification = this.registeredNotifications[file.path][n_key];
                    let opts: NotificationOptions = {
                        body: notification.body,
                    }
                    notification.notification = new Notification(notification.title, opts)
                    notification.notified = true
                })
            }
        }
    }

    async printFiles(app: App) {
        app.vault.getMarkdownFiles()
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class SampleSettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let {containerEl} = this;

        containerEl.empty();

        containerEl.createEl('h2', {text: 'Obsidian Notifier'});

        new Setting(containerEl)
            .setName('Due Frontmatter key')
            .setDesc('Frontmatter key used to determine when to notify')
            .addText(text => text
                .setPlaceholder('Default: due')
                .setValue(this.plugin.settings.dueKey)
                .onChange(async (value) => {
                    this.plugin.settings.dueKey = value;
                    await this.plugin.saveSettings();
                }));

    }
}
