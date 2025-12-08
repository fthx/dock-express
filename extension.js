/*
    Dock Express - GNOME Shell 46+ extension
    Copyright @fthx 2025 - License GPL v3
*/


import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


const HOT_EDGE_PRESSURE_TIMEOUT = 500; // ms

const BottomDock = GObject.registerClass(
    class BottomDock extends Clutter.Actor {
        _init(settings) {
            super._init();

            this._settings = settings;
            this._animationDuration = this._settings?.get_int('animation-duration') ?? 200;
            this._dimmedOpacity = (Math.round(this._settings?.get_int('dimmed-opacity') ?? 50) / 100 * 255);

            this._initDash();
            this._initPressureBarrier();
            this._setHotEdge();

            Main.layoutManager.connectObject('monitors-changed', () => this._setHotEdge(), GObject.ConnectFlags.AFTER, this);

            Main.overview.connectObject(
                'shown', () => this._onOverviewShown(), GObject.ConnectFlags.AFTER,
                'hidden', () => this._onOverviewHidden(), GObject.ConnectFlags.AFTER,
                this);
        }

        _initPressureBarrier() {
            this._pressureBarrier = new Layout.PressureBarrier(
                this._settings?.get_int('pressure-threshold') ?? 100,
                HOT_EDGE_PRESSURE_TIMEOUT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);

            this._pressureBarrier.connectObject('trigger', () => this._toggleDash(), this);
        }

        _setMonitor() {
            this._monitor = Main.layoutManager.primaryMonitor;
            if (!this._monitor)
                return;

            this._w = this._monitor.width;
            this._h = this._monitor.height;
            this._x = this._monitor.x;
            this._y = this._monitor.y;
        }

        _setBarrier() {
            this._destroyBarrier();

            this._barrier = new Meta.Barrier({
                backend: global.backend,
                x1: this._x,
                y1: this._y + this._h,
                x2: this._x + this._w,
                y2: this._y + this._h,
                directions: Meta.BarrierDirection.NEGATIVE_Y
            });

            this._pressureBarrier.addBarrier(this._barrier);
        }

        _setHotEdge() {
            this._dash.opacity = 0;

            Main.layoutManager._queueUpdateRegions();

            if (this._hotEdgeTimeout)
                GLib.Source.remove(this._hotEdgeTimeout);

            this._hotEdgeTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._setMonitor();
                this._setBarrier();
                this._setDashPosition();

                this._dash.opacity = 255;
                this._dashWasShown = true;
                Main.overview.show();

                this._hotEdgeTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        _destroyBarrier() {
            if (this._barrier) {
                this._pressureBarrier?.removeBarrier(this._barrier);
                this._barrier.destroy();
                this._barrier = null;
            }
        }

        _destroyPressureBarrier() {
            this._destroyBarrier();

            this._pressureBarrier?.disconnectObject(this);
            this._pressureBarrier?.destroy();
            this._pressureBarrier = null;
        }

        _initDash() {
            this._dash = Main.overview.dash;

            this._dash._dashContainer.connectObject(
                'scroll-event', (actor, event) => Main.wm.handleWorkspaceScroll(event),
                'notify::hover', () => this._onDashHover(),
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
            this._dash.set_pivot_point(0.5, 1.0);

            this._dash.showAppsButton.connectObject('notify::checked', () => Main.overview.showApps(), this);

            if (Main.overview._overview._controls.get_children().includes(this._dash)) {
                Main.overview._overview._controls.remove_child(this._dash);
                Main.layoutManager.addTopChrome(this._dash, {
                    affectsInputRegion: true, affectsStruts: false, trackFullscreen: false
                });
            }
        }

        _setDashPosition() {
            const x = Math.round(this._x + (this._w - this._dash._dashContainer.width) / 2);
            const y = Math.round(this._y + this._h - this._dash._dashContainer.height);
            this._dash.set_position(x, y);
        }

        _raiseDash() {
            this._dash.remove_all_transitions();

            this._dash.show();
            this._dash.ease({
                duration: this._animationDuration,
                scale_y: 1,
                opacity: 255,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
        }

        _hideDash() {
            this._dash.remove_all_transitions();

            this._dash.ease({
                duration: this._animationDuration,
                scale_y: 0,
                opacity: 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._dash.hide();
                    this._dashWasShown = false;
                },
            });
        }

        _dimDash() {
            this._dash.remove_all_transitions();

            this._dash.show();
            this._dash.ease({
                duration: this._animationDuration * 4,
                opacity: this._dimmedOpacity,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        _toggleDash() {
            if (this._monitor?.inFullscreen
                || (global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK)
                || Main.overview.visible)
                return;

            if (!this._dash.visible) {
                this._dashWasShown = true;
                this._raiseDash();
            } else if (!this._settings?.get_boolean('dock-autohide'))
                this._hideDash();
        }

        _onOverviewShown() {
            if (this._overviewTimeout)
                GLib.Source.remove(this._overviewTimeout);

            this._overviewTimeout = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._raiseDash();

                this._overviewTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        _onOverviewHidden() {
            if (this._settings?.get_boolean('dock-autohide') || !this._dashWasShown)
                this._hideDash();
            else
                this._dimDash();
        }

        _onDashHover() {
            if (Main.overview.visible || !this._dash.visible)
                return;

            if (this._settings?.get_boolean('dock-autohide')) {
                if (!this._dash._dashContainer.hover && !this._keepDashShown)
                    this._hideDash();
            } else {
                if (this._dash._dashContainer.hover)
                    this._raiseDash();
                else
                    this._dimDash();
            }
        }

        _restoreDash() {
            if (this._dash) {
                this._dash.remove_all_transitions();
                this._dash.show();
                this._dash.opacity = 255;

                this._dash._dashContainer.disconnectObject(this);
                this._dash.showAppsButton.disconnectObject(this);

                this._dash._dashContainer.reactive = false;
                this._dash._dashContainer.track_hover = false;
                this._dash.set_pivot_point(0.0, 0.0);

                this._dash._itemMenuStateChanged = this._originalItemMenuChanged;

                if (this._dash.get_parent() === Main.layoutManager.uiGroup) {
                    Main.layoutManager.removeChrome(this._dash);
                    Main.overview._overview._controls.add_child(this._dash);
                }
            }
        }

        destroy() {
            if (this._hotEdgeimeout) {
                GLib.Source.remove(this._hotEdgeTimeout);
                this._hotEdgeTimeout = null;
            }

            if (this._overviewTimeout) {
                GLib.Source.remove(this._overviewTimeout);
                this._overviewTimeout = null;
            }

            this._dash.remove_all_transitions();
            Main.overview.disconnectObject(this);
            Main.layoutManager.disconnectObject(this);

            this._destroyPressureBarrier();
            this._restoreDash();

            super.destroy();
        }
    });

export default class DockExpressExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    _initDock() {
        this._settings = this.getSettings();
        this._settings?.connectObject('changed', () => this._restart(), this);

        this._dock = new BottomDock(this._settings);
    }

    _restart() {
        this.disable();
        this.enable();
    }

    enable() {
        if (Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', () => this._initDock(), this);
        else
            this._initDock();
    }

    disable() {
        this._settings?.disconnectObject(this);
        this._settings = null;

        Main.layoutManager.disconnectObject(this);

        this._dock?.destroy();
        this._dock = null;
    }
}
