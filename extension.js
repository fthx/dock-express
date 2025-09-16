/*
    Dock Express - GNOME Shell 46+ extension
    Copyright @fthx 2025 - License GPL v3
*/


import Clutter from 'gi://Clutter';
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

const DockAutohideButton = GObject.registerClass(
    class DockAutohideButton extends PanelMenu.Button {
        _init(settings) {
            super._init();

            this._settings = settings;

            this._icon = new St.Icon({ style_class: 'system-status-icon' });
            this._updateIcon();
            this.add_child(this._icon);

            this.connectObject('button-press-event', this._onClicked.bind(this), this);
        }

        _updateIcon() {
            if (this._settings.get_boolean('dock-autohide'))
                this._icon.icon_name = 'changes-allow-symbolic';
            else
                this._icon.icon_name = 'changes-prevent-symbolic';
        }

        _onClicked() {
            this._settings.set_boolean('dock-autohide', !this._settings.get_boolean('dock-autohide'));
            this._updateIcon();
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
                'shown', () => this._toggleDash(),
                'hidden', () => this._onDashHover(),
                this);

            this.connectObject('destroy', this._destroy.bind(this), this);
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

            this._dash.showAppsButton.set_toggle_mode(false);
            this._dash.showAppsButton.connectObject('button-release-event', () => Main.overview.showApps(), this);

            if (Main.overview._overview._controls.get_children().includes(this._dash)) {
                Main.overview._overview._controls.remove_child(this._dash);
                Main.layoutManager.addTopChrome(this._dash, { affectsStruts: false });
            }
        }

        _toggleDash() {
            if (this._monitor.inFullscreen || (global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK))
                return;

            if (!this._dash.visible) {
                let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);

                if (workArea) {
                    let x = workArea.x + (workArea.width - this._dash.width) / 2;
                    let y = workArea.y + workArea.height - this._dash.height;
                    this._dash.set_position(x, y);

                    this._dash.show();
                    this._dash.ease({
                        duration: ANIMATION_DURATION,
                        opacity: 255,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    });
                }
            } else {
                if (!this._settings.get_boolean('dock-autohide') && !Main.overview.visible) {
                    this._dash.ease({
                        duration: ANIMATION_DURATION,
                        opacity: 0,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => this._dash.hide(),
                    });
                }
            }
        }

        _onDashHover() {
            if (Main.overview.visible)
                return;

            if (this._settings.get_boolean('dock-autohide')) {
                if (!this._dash._dashContainer.hover && !this._keepDashShown) {
                    this._dash.ease({
                        duration: ANIMATION_DURATION * 4,
                        opacity: 0,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => this._dash.hide(),
                    });
                }
            } else {
                if (this._dash._dashContainer.hover)
                    this._dash.ease({
                        duration: ANIMATION_DURATION,
                        opacity: 255,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    });
                else
                    this._dash.ease({
                        duration: ANIMATION_DURATION,
                        opacity: DASH_NOT_HOVER_OPACITY,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
            }
        }

        vfunc_leave_event(event) {
            return Clutter.EVENT_PROPAGATE;
        }

        _destroy() {
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

            super.destroy();
        }
    });

export default class DockExpressExtension extends Extension {
    _updateHotEdge() {
        let monitor = Main.layoutManager.primaryMonitor;
        let leftX = monitor.x;
        let bottomY = monitor.y + monitor.height;
        let size = monitor.width;

        this._edge = new BottomDock(this._settings, monitor, leftX, bottomY);

        this._edge._dash.hide();
        this._edge._toggleDash();

        this._edge.setBarrierSize(size);
        Main.layoutManager.hotCorners.push(this._edge);
    }

    _initDock() {
        this._updateHotEdge();

        this._dockAutohideButton = new DockAutohideButton(this._settings);
        Main.panel.addToStatusArea('dock-express-button', this._dockAutohideButton);

        Main.layoutManager.connectObject('hot-corners-changed', this._updateHotEdge.bind(this), this);
        global.display.connectObject('workareas-changed', () => Main.overview.show(), this);
    }

    enable() {
        this._settings = this.getSettings();

        if (Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', this._initDock.bind(this), this);
        else
            this._initDock();
    }

    disable() {
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);

        Main.layoutManager.disconnectObject(this);
        Main.layoutManager._updateHotCorners();

        this._dockAutohideButton.destroy();
        this._dockAutohideButton = null;

        this._edge = null;

        this._settings = null;
    }
}
