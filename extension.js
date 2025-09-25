/*
    Dock Express - GNOME Shell 46+ extension
    Copyright @fthx 2025 - License GPL v3
*/


import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


const HOT_EDGE_PRESSURE_TIMEOUT = 500; // ms
const PRESSURE_THRESHOLD = 100; // > 0
const EDGE_SIZE = 100; // %
const ANIMATION_DURATION = 150; // ms
const DASH_NOT_HOVER_OPACITY = 128; // 0...255
const ICON_INACTIVE_OPACITY = 128; //0...255

const DockAutohideButton = GObject.registerClass(
    class DockAutohideButton extends PanelMenu.Button {
        _init(settings) {
            super._init();

            this._settings = settings;

            this._icon = new St.Icon({ style_class: 'system-status-icon', icon_name: 'pan-down-symbolic' });
            this._updateIcon();
            this.add_child(this._icon);

            this.connectObject('button-press-event', this._onClicked.bind(this), this);
        }

        _updateIcon() {
            if (this._settings.get_boolean('dock-autohide'))
                this._icon.opacity = ICON_INACTIVE_OPACITY;
            else
                this._icon.opacity = 255;
        }

        _onClicked() {
            this._settings.set_boolean('dock-autohide', !this._settings.get_boolean('dock-autohide'));
            this._updateIcon();
        }
    });

const PanelHideButton = GObject.registerClass(
    class PanelHideButton extends PanelMenu.Button {
        _init(settings) {
            super._init();

            this._settings = settings;

            this._icon = new St.Icon({ style_class: 'system-status-icon', icon_name: 'pan-up-symbolic' });
            this._updateIcon();
            this.add_child(this._icon);

            this.connectObject('button-press-event', this._onClicked.bind(this), this);
        }

        _updateIcon() {
            if (this._settings.get_boolean('panel-hide'))
                this._icon.opacity = ICON_INACTIVE_OPACITY;
            else
                this._icon.opacity = 255;
        }

        _onClicked() {
            this._settings.set_boolean('panel-hide', !this._settings.get_boolean('panel-hide'));

            this._updateIcon();
            this._togglePanel();
        }

        _showPanel() {
            if (Main.layoutManager.overviewGroup.get_children().includes(Main.layoutManager.panelBox))
                Main.layoutManager.overviewGroup.remove_child(Main.layoutManager.panelBox);
            if (Main.layoutManager.panelBox.get_parent() != Main.layoutManager.uiGroup)
                Main.layoutManager.addChrome(Main.layoutManager.panelBox, { affectsStruts: true, trackFullscreen: false });

            Main.overview.searchEntry.get_parent().set_style('margin-top: 0px;');
        }

        _hidePanel() {
            if (Main.layoutManager.panelBox.get_parent() == Main.layoutManager.uiGroup)
                Main.layoutManager.removeChrome(Main.layoutManager.panelBox);
            if (!Main.layoutManager.overviewGroup.get_children().includes(Main.layoutManager.panelBox))
                Main.layoutManager.overviewGroup.insert_child_at_index(Main.layoutManager.panelBox, 0);

            Main.overview.searchEntry.get_parent().set_style('margin-top: 32px;');
        }

        _togglePanel() {
            if (this._settings.get_boolean('panel-hide'))
                this._hidePanel();
            else
                this._showPanel();
        }

        destroy() {
            this._showPanel();

            super.destroy();
        }
    });

const BottomDock = GObject.registerClass(
    class BottomDock extends Clutter.Actor {
        _init(settings, monitor, x, y) {
            super._init();

            this._settings = settings;

            this._initDash();

            this._monitor = monitor;
            this._x = x;
            this._y = y;

            this._edgeSize = EDGE_SIZE / 100;
            this._pressureThreshold = PRESSURE_THRESHOLD;

            this._pressureBarrier = new Layout.PressureBarrier(
                this._pressureThreshold,
                HOT_EDGE_PRESSURE_TIMEOUT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);

            this._pressureBarrier?.connectObject('trigger', this._toggleDash.bind(this), this);

            Main.overview.connectObject(
                'showing', this._raiseDash.bind(this),
                'hidden', this._onOverviewHidden.bind(this),
                this);
        }

        setBarrierSize(size) {
            if (this._barrier) {
                this._pressureBarrier?.removeBarrier(this._barrier);
                this._barrier.destroy();
                this._barrier = null;
            }

            if (size > 0) {
                size = this._monitor.width * this._edgeSize;
                let x_offset = (this._monitor.width - size) / 2;
                this._barrier = new Meta.Barrier({
                    backend: global.backend,
                    x1: this._x + x_offset, x2: this._x + x_offset + size,
                    y1: this._y, y2: this._y,
                    directions: Meta.BarrierDirection.NEGATIVE_Y
                });
                this._pressureBarrier?.addBarrier(this._barrier);
            }
        }

        _initDash() {
            this._dash = Main.overview.dash;
            this._dash._dashContainer.connectObject(
                'scroll-event', (actor, event) => Main.wm.handleWorkspaceScroll(event),
                'notify::hover', this._onDashHover.bind(this),
                this);

            this._keepDashShown = false;
            this._originalItemMenuChanged = this._dash._itemMenuStateChanged;
            this._dash._itemMenuStateChanged = (item, opened) => {
                if (opened) {
                    if (this._showLabelTimeoutId > 0) {
                        GLib.source_remove(this._showLabelTimeoutId);
                        this._showLabelTimeoutId = 0;
                    }
                    item.hideLabel();

                    this._keepDashShown = true;
                } else
                    this._keepDashShown = false;
            }

            this._dash._dashContainer.track_hover = true;
            this._dash._dashContainer.reactive = true;

            this._dash.showAppsButton.connectObject('notify::checked', () => Main.overview.showApps(), this);

            if (Main.overview._overview._controls.get_children().includes(this._dash)) {
                Main.overview._overview._controls.remove_child(this._dash);
                Main.layoutManager.addTopChrome(this._dash, {
                    affectsInputRegion: true, affectsStruts: false, trackFullscreen: true
                });
            }
        }

        _enableUnredirect() {
            if (this._originalEnableUnredirect) {
                global.compositor.enable_unredirect = this._originalEnableUnredirect;
                global.compositor.enable_unredirect();
                this._originalEnableUnredirect = null;
            }
        }

        _disableUnredirect() {
            if (this._settings.get_boolean('panel-hide')) {
                this._originalEnableUnredirect = global.compositor.enable_unredirect;
                global.compositor.enable_unredirect = () => { };
                global.compositor.disable_unredirect();
            }
        }

        _raiseDash() {
            this._disableUnredirect();

            let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
            if (workArea) {
                let x = Math.round(workArea.x + (workArea.width - this._dash.width) / 2);
                let y = Math.round(workArea.y + workArea.height - this._dash.height);
                this._dash.set_position(x, y);
            }

            this._dash.show();
            this._dash.ease({
                duration: ANIMATION_DURATION,
                opacity: 255,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
        }

        _hideDash() {
            this._dash.ease({
                duration: ANIMATION_DURATION * 4,
                opacity: 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this._dash.hide(),
            });

            this._enableUnredirect();
        }

        _dimDash() {
            this._dash.ease({
                duration: ANIMATION_DURATION * 4,
                opacity: DASH_NOT_HOVER_OPACITY,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        _toggleDash() {
            if (this._monitor.inFullscreen || (global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK))
                return;

            if (!this._dash.visible)
                this._raiseDash();
            else {
                if (!this._settings.get_boolean('dock-autohide') && !Main.overview.visible)
                    this._hideDash();
            }
        }

        _onOverviewHidden() {
            if (this._settings.get_boolean('dock-autohide'))
                this._hideDash();
            else {
                if (!this._dash._dashContainer.hover)
                    this._dimDash();
            }
        }

        _onDashHover() {
            if (Main.overview.visible)
                return;

            if (this._settings.get_boolean('dock-autohide')) {
                if (!this._dash._dashContainer.hover && !this._keepDashShown)
                    this._hideDash();
            } else {
                if (this._dash._dashContainer.hover)
                    this._raiseDash();
                else
                    this._dimDash();
            }
        }

        vfunc_leave_event(event) {
            return Clutter.EVENT_PROPAGATE;
        }

        destroy() {
            Main.overview.disconnectObject(this);

            this._dash?._dashContainer?.disconnectObject(this);
            this._dash?.showAppsButton?.disconnectObject(this);
            this._dash.opacity = 255;

            this._dash._itemMenuStateChanged = this._originalItemMenuChanged;

            if (this._dash && (this._dash.get_parent() == Main.layoutManager.uiGroup)) {
                Main.layoutManager.removeChrome(this._dash);
                Main.overview._overview._controls.add_child(this._dash);
            }

            this.setBarrierSize(0);

            this._pressureBarrier?.disconnectObject(this);
            this._pressureBarrier?.destroy();
            this._pressureBarrier = null;

            this._enableUnredirect();

            super.destroy();
        }
    });

export default class DockExpressExtension extends Extension {
    _updateHotEdge() {
        Main.overview.show();

        if (this._timeout)
            GLib.Source.remove(this._timeout);

        this._timeout = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            Main.overview.hide();

            let monitor = Main.layoutManager.primaryMonitor;
            let leftX = monitor.x;
            let bottomY = monitor.y + monitor.height;
            let size = monitor.width;

            this._edge = new BottomDock(this._settings, monitor, leftX, bottomY);
            this._edge._raiseDash();

            this._edge.setBarrierSize(size);
            Main.layoutManager.hotCorners.push(this._edge);

            this._timeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _initDock() {
        this._updateHotEdge();

        this._dockAutohideButton = new DockAutohideButton(this._settings);
        Main.panel.addToStatusArea('dock-express-button', this._dockAutohideButton);

        this._panelHideButton = new PanelHideButton(this._settings);
        Main.panel.addToStatusArea('dock-express-panel', this._panelHideButton);
        this._panelHideButton._togglePanel();

        Main.layoutManager.connectObject('hot-corners-changed', this._updateHotEdge.bind(this), this);
    }

    enable() {
        this._settings = this.getSettings();

        if (Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', this._initDock.bind(this), this);
        else
            this._initDock();
    }

    disable() {
        this._dockAutohideButton.destroy();
        this._dockAutohideButton = null;

        this._panelHideButton.destroy();
        this._panelHideButton = null;

        Main.layoutManager.disconnectObject(this);
        Main.layoutManager._destroyHotCorners();
        Main.layoutManager._updateHotCorners();

        this._edge = null;
        if (this._timeout) {
            GLib.Source.remove(this._timeout);
            this._timeout = null;
        }
        this._settings = null;
    }
}
