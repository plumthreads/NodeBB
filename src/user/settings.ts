
import validator from 'validator';

import { SettingsObject } from '../types';

import meta from '../meta';
import db from '../database';
import plugins from '../plugins';
import notifications from '../notifications';
import languages from '../languages';

interface UserType {
    getSettings: (uid: number) => Promise<SettingsObject>;
    getMultipleUserSettings: (uids: number[]) => Promise<SettingsObject[]>;
    saveSettings: (uid: number, data: SettingsObject) => Promise<SettingsObject>;
    updateDigestSetting: (uid: number, dailyDigestFReq: string) => Promise<void>;
    setSetting: (uid: number, key: string, value: string | number | boolean) => Promise<void>;
}

export default function (User: UserType): void {
    User.getSettings = async function (uid: number): Promise<SettingsObject> {
        if (uid <= 0) {
            return await onSettingsLoaded(0, {} as SettingsObject);
        }
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call        
        let settings: SettingsObject = await db.getObject(`user:${uid}:settings`) as SettingsObject;
        settings = settings || {} as SettingsObject;
        settings.uid = uid;
        return await onSettingsLoaded(uid, settings);
    };

    User.getMultipleUserSettings = async function (uids: number[]): Promise<SettingsObject[]> {
        if (!Array.isArray(uids) || !uids.length) {
            return [];
        }

        const keys = uids.map(uid => `user:${uid}:settings`);
        let settings: SettingsObject[] = await db.getObjects(keys);
        settings = settings.map((userSettings, index) => {
            userSettings = userSettings || {} as SettingsObject;
            userSettings.uid = uids[index];
            return userSettings;
        });
        return await Promise.all(settings.map(s => onSettingsLoaded(s.uid, s)));
    };

    async function onSettingsLoaded(uid: number, settings: SettingsObject): Promise<SettingsObject> {
        const data = await plugins.hooks.fire('filter:user.getSettings', { uid: uid, settings: settings });
        settings = data.settings;

        const defaultTopicsPerPage = meta.config.topicsPerPage;
        const defaultPostsPerPage = meta.config.postsPerPage;

        settings.showemail = getSetting(settings, 'showemail', false) as boolean;
        settings.showfullname = getSetting(settings, 'showfullname', false) as boolean;
        settings.openOutgoingLinksInNewTab = getSetting(settings, 'openOutgoingLinksInNewTab', false) as boolean;
        settings.dailyDigestFreq = getSetting(settings, 'dailyDigestFreq', 'off') as string;
        settings.usePagination = getSetting(settings, 'usePagination', false) as boolean;
        settings.topicsPerPage = Math.min(
            meta.config.maxTopicsPerPage,
            settings.topicsPerPage ? settings.topicsPerPage : defaultTopicsPerPage,
            defaultTopicsPerPage
        );
        settings.postsPerPage = Math.min(
            meta.config.maxPostsPerPage,
            settings.postsPerPage ? settings.postsPerPage : defaultPostsPerPage,
            defaultPostsPerPage
        );
        settings.userLang = settings.userLang || meta.config.defaultLang || 'en-GB';
        settings.acpLang = settings.acpLang || settings.userLang;
        settings.topicPostSort = getSetting(settings, 'topicPostSort', 'oldest_to_newest') as string;
        settings.categoryTopicSort = getSetting(settings, 'categoryTopicSort', 'newest_to_oldest') as string;
        settings.followTopicsOnCreate = getSetting(settings, 'followTopicsOnCreate', true) as boolean;
        settings.followTopicsOnReply = getSetting(settings, 'followTopicsOnReply', false) as boolean;
        settings.upvoteNotifFreq = getSetting(settings, 'upvoteNotifFreq', 'all') as string;
        settings.restrictChat = getSetting(settings, 'restrictChat', false) as boolean;
        settings.topicSearchEnabled = getSetting(settings, 'topicSearchEnabled', false) as boolean;
        settings.updateUrlWithPostIndex = getSetting(settings, 'updateUrlWithPostIndex', true) as boolean;
        settings.bootswatchSkin = validator.escape(String(settings.bootswatchSkin || ''));
        settings.homePageRoute = validator.escape(String(settings.homePageRoute || '')).replace(/&#x2F;/g, '/');
        settings.scrollToMyPost = getSetting(settings, 'scrollToMyPost', true) as boolean;
        settings.categoryWatchState = getSetting(settings, 'categoryWatchState', 'notwatching') as string;

        const notificationTypes = await notifications.getAllNotificationTypes();
        notificationTypes.forEach((notificationType) => {
            settings[notificationType] = getSetting(settings, notificationType, 'notification') as string;
        });

        return settings;
    }

    function getSetting(settings: SettingsObject, key: string, defaultValue: boolean | string | number): boolean | string | number{
        if (settings[key] || settings[key] === 0) {
            return settings[key];
        } else if (meta.config[key] || meta.config[key] === 0) {
            return meta.config[key];
        }
        return defaultValue;
    }

    User.saveSettings = async function (uid: number, data: SettingsObject): Promise<SettingsObject> {
        const maxPostsPerPage = meta.config.maxPostsPerPage || 20;
        if (
            !data.postsPerPage ||
            data.postsPerPage <= 1 ||
            data.postsPerPage > maxPostsPerPage
        ) {
            throw new Error(`[[error:invalid-pagination-value, 2, ${maxPostsPerPage}]]`);
        }

        const maxTopicsPerPage = meta.config.maxTopicsPerPage || 20;
        if (
            !data.topicsPerPage ||
            data.topicsPerPage <= 1 ||
            data.topicsPerPage > maxTopicsPerPage
        ) {
            throw new Error(`[[error:invalid-pagination-value, 2, ${maxTopicsPerPage}]]`);
        }

        const languageCodes = await languages.listCodes();
        if (data.userLang && !languageCodes.includes(data.userLang)) {
            throw new Error('[[error:invalid-language]]');
        }
        if (data.acpLang && !languageCodes.includes(data.acpLang)) {
            throw new Error('[[error:invalid-language]]');
        }
        data.userLang = data.userLang || meta.config.defaultLang;

        plugins.hooks.fire('action:user.saveSettings', { uid: uid, settings: data });

        const settings: Partial<SettingsObject> = {
            showemail: data.showemail,
            showfullname: data.showfullname,
            openOutgoingLinksInNewTab: data.openOutgoingLinksInNewTab,
            dailyDigestFreq: data.dailyDigestFreq || 'off',
            usePagination: data.usePagination,
            topicsPerPage: Math.min(data.topicsPerPage, parseInt(maxTopicsPerPage, 10) || 20),
            postsPerPage: Math.min(data.postsPerPage, parseInt(maxPostsPerPage, 10) || 20),
            userLang: data.userLang || meta.config.defaultLang,
            acpLang: data.acpLang || meta.config.defaultLang,
            followTopicsOnCreate: data.followTopicsOnCreate,
            followTopicsOnReply: data.followTopicsOnReply,
            restrictChat: data.restrictChat,
            topicSearchEnabled: data.topicSearchEnabled,
            updateUrlWithPostIndex: data.updateUrlWithPostIndex,
            homePageRoute: ((data.homePageRoute === 'custom' ? data.homePageCustom : data.homePageRoute) || '').replace(/^\//, ''),
            scrollToMyPost: data.scrollToMyPost,
            upvoteNotifFreq: data.upvoteNotifFreq,
            bootswatchSkin: data.bootswatchSkin,
            categoryWatchState: data.categoryWatchState,
            categoryTopicSort: data.categoryTopicSort,
            topicPostSort: data.topicPostSort,
        };
        const notificationTypes = await notifications.getAllNotificationTypes();
        notificationTypes.forEach((notificationType) => {
            if (data[notificationType]) {
                settings[notificationType] = data[notificationType];
            }
        });
        const result = await plugins.hooks.fire('filter:user.saveSettings', { uid: uid, settings: settings, data: data });
        await db.setObject(`user:${uid}:settings`, result.settings);
        await User.updateDigestSetting(uid, data.dailyDigestFreq);
        return await User.getSettings(uid);
    };

    User.updateDigestSetting = async function (uid: number, dailyDigestFreq: string): Promise<void> {
        await db.sortedSetsRemove(['digest:day:uids', 'digest:week:uids', 'digest:month:uids'], uid);
        if (['day', 'week', 'biweek', 'month'].includes(dailyDigestFreq)) {
            await db.sortedSetAdd(`digest:${dailyDigestFreq}:uids`, Date.now(), uid);
        }
    };

    User.setSetting = async function (uid: number, key: string, value: boolean | number | string): Promise<void> {
        if (uid <= 0) {
            return;
        }

        await db.setObjectField(`user:${uid}:settings`, key, value);
    };
};
