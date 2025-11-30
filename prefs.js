import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class DockExpressPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Dock Express extension',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);


        const groupGlobal = new Adw.PreferencesGroup();
        page.add(groupGlobal);

        const hideDock = new Adw.SwitchRow({
            title: 'Hide dock',
            subtitle: 'Dock appears on bottom edge pressure.\nIn always-show mode, a bottom edge pressure toggles the dock.',
        });
        groupGlobal.add(hideDock);
        window._settings.bind('dock-autohide', hideDock, 'active', Gio.SettingsBindFlags.DEFAULT);

        const adjustmentPressure = new Gtk.Adjustment({
            lower: 0,
            upper: 200,
            step_increment: 10,
        });

        const pressureTreshold = new Adw.SpinRow({
            title: 'Pressure treshold to trigger the dock',
            subtitle: 'Default value: 100.',
            adjustment: adjustmentPressure,
        });
        groupGlobal.add(pressureTreshold);
        window._settings.bind('pressure-treshold', pressureTreshold, 'value', Gio.SettingsBindFlags.DEFAULT);

        const adjustmentAnimation = new Gtk.Adjustment({
            lower: 0,
            upper: 500,
            step_increment: 50,
        });

        const animationDuration = new Adw.SpinRow({
            title: 'Show/hide animation duration (ms)',
            subtitle: 'Default value: 150.\nDim opacity animation duration is 4 times this value.',
            adjustment: adjustmentAnimation,
        });
        groupGlobal.add(animationDuration);
        window._settings.bind('animation-duration', animationDuration, 'value', Gio.SettingsBindFlags.DEFAULT);

        const adjustmentOpacity = new Gtk.Adjustment({
            lower: 0,
            upper: 100,
            step_increment: 5,
        });

        const dimmedOpacity = new Adw.SpinRow({
            title: 'Dock dimmed opacity (%)',
            subtitle: 'Default value: 50.\nDimmed opacity is only used in always-show mode.',
            adjustment: adjustmentOpacity,
        });
        groupGlobal.add(dimmedOpacity);
        window._settings.bind('animation-duration', dimmedOpacity, 'value', Gio.SettingsBindFlags.DEFAULT);
    }
}
