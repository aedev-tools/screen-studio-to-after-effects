/**
 * ssae.jsx — Screen Studio → After Effects
 *
 * Run in AE: File → Scripts → Run Script File
 * Prompts to pick a .screenstudio project, then builds the full comp.
 */

(function() {

    // ================================================================
    // HELPERS
    // ================================================================

    function readJSON(filePath) {
        var f = new File(filePath);
        if (!f.exists) return null;
        f.encoding = "UTF-8";
        f.open("r");
        var str = f.read();
        f.close();
        return eval("(" + str + ")");
    }

    function findFile(folder, patterns) {
        if (!folder || !folder.exists) return null;
        var files = folder.getFiles();
        for (var i = 0; i < files.length; i++) {
            if (files[i] instanceof File) {
                var name = files[i].name;
                var match = true;
                for (var j = 0; j < patterns.length; j++) {
                    if (name.indexOf(patterns[j]) === -1) {
                        match = false;
                        break;
                    }
                }
                if (match) return files[i];
            }
        }
        return null;
    }

    function findFileByName(folder, filename) {
        if (!folder || !folder.exists) return null;
        var f = new File(folder.fsName + "/" + filename);
        return f.exists ? f : null;
    }

    function hexToRGB(hex) {
        hex = hex.replace("#", "");
        return [
            parseInt(hex.substring(0, 2), 16) / 255,
            parseInt(hex.substring(2, 4), 16) / 255,
            parseInt(hex.substring(4, 6), 16) / 255
        ];
    }

    var BK = 0.5522847498;

    function applyEase(prop, keyIdx, influence) {
        prop.setInterpolationTypeAtKey(keyIdx,
            KeyframeInterpolationType.BEZIER,
            KeyframeInterpolationType.BEZIER
        );
        for (var dim = 1; dim <= 4; dim++) {
            try {
                var eIn = [];
                var eOut = [];
                for (var d = 0; d < dim; d++) {
                    eIn.push(new KeyframeEase(0, influence));
                    eOut.push(new KeyframeEase(0, influence));
                }
                prop.setTemporalEaseAtKey(keyIdx, eIn, eOut);
                return;
            } catch(e3) {}
        }
    }

    function makeRoundedRect(w, h, r) {
        if (r > Math.min(w, h) / 2) r = Math.min(w, h) / 2;
        var shape = new Shape();
        shape.vertices = [
            [r, 0], [w - r, 0],
            [w, r], [w, h - r],
            [w - r, h], [r, h],
            [0, h - r], [0, r]
        ];
        shape.inTangents = [
            [-r * BK, 0], [0, 0],
            [0, -r * BK], [0, 0],
            [r * BK, 0], [0, 0],
            [0, r * BK], [0, 0]
        ];
        shape.outTangents = [
            [0, 0], [r * BK, 0],
            [0, 0], [0, r * BK],
            [0, 0], [-r * BK, 0],
            [0, 0], [0, -r * BK]
        ];
        shape.closed = true;
        return shape;
    }

    function importFileToFolder(file, folder) {
        if (!file || !file.exists) return null;
        var io = new ImportOptions(file);
        var item = app.project.importFile(io);
        item.parentFolder = folder;
        return item;
    }

    // ================================================================
    // MAIN
    // ================================================================

    // 1. PICK PROJECT
    // .screenstudio bundles are macOS packages — they appear as files, not folders
    var projectFile = File.openDialog("Select your .screenstudio project", "*.screenstudio");
    if (!projectFile) return;

    var basePath = projectFile.fsName;
    var recFolder = new Folder(basePath + "/recording");

    if (!recFolder.exists) {
        alert("Error: No 'recording' folder found.\nMake sure you selected a .screenstudio project.");
        return;
    }

    app.beginUndoGroup("Screen Studio Import");
    try {

        // ============================================================
        // 2. READ PROJECT DATA
        // ============================================================
        var projRaw = readJSON(basePath + "/project.json");
        if (!projRaw) { alert("Error: Cannot read project.json"); return; }
        var proj = projRaw.json || projRaw;
        var config = proj.config;

        // ============================================================
        // 3. READ METADATA
        // ============================================================
        var metaRaw = readJSON(recFolder.fsName + "/metadata.json");
        if (!metaRaw) { alert("Error: Cannot read metadata.json"); return; }
        var metadata = metaRaw.json || metaRaw;

        // Find recorders/channels
        var recorders = metadata.recorders || metadata.channels || [];
        var displayRec = null, webcamRec = null, sysAudioRec = null, micRec = null;
        for (var i = 0; i < recorders.length; i++) {
            var r = recorders[i];
            if (r.type === "display") displayRec = r;
            else if (r.type === "webcam") webcamRec = r;
            else if (r.type === "systemAudio") sysAudioRec = r;
            else if (r.type === "microphone") micRec = r;
        }

        if (!displayRec) { alert("Error: No display recorder in metadata"); return; }

        // Get bounds from display recorder session
        var displaySession = (displayRec.sessions && displayRec.sessions.length > 0)
            ? displayRec.sessions[0] : {};
        var bounds = displaySession.bounds || displayRec.bounds;
        if (!bounds) { alert("Error: No display bounds in metadata"); return; }

        // Timing
        var topSessions = metadata.sessions || [];
        var processTimeStart, processTimeEnd;
        if (topSessions.length > 0) {
            processTimeStart = topSessions[0].processTimeStartMs;
            processTimeEnd = topSessions[0].processTimeEndMs;
        } else {
            processTimeStart = displaySession.processTimeStartMs;
            processTimeEnd = displaySession.processTimeEndMs;
        }
        var totalDuration = (processTimeEnd - processTimeStart) / 1000.0;

        // ============================================================
        // 4. FIND & IMPORT MEDIA FILES
        // ============================================================
        function getMediaFile(rec) {
            if (!rec) return null;
            var sess = (rec.sessions && rec.sessions.length > 0) ? rec.sessions[0] : null;
            if (sess && sess.outputFilename) {
                var f = new File(recFolder.fsName + "/" + sess.outputFilename);
                if (f.exists) return f;
            }
            return findFile(recFolder, [rec.type]);
        }

        var displayFile = getMediaFile(displayRec);
        var webcamFile = getMediaFile(webcamRec);
        var sysAudioFile = getMediaFile(sysAudioRec);

        // Microphone: prefer enhanced version
        var micFile = null;
        var enhancedFolder = new Folder(recFolder.fsName + "/enhanced");
        if (enhancedFolder.exists && micRec) {
            micFile = findFile(enhancedFolder, ["microphone", "enhanced"]);
        }
        if (!micFile) {
            micFile = getMediaFile(micRec);
        }

        // Import media
        var rootFolder = app.project.items.addFolder("Screen Studio - " + proj.name);
        var footageFolder = app.project.items.addFolder("Footage");
        footageFolder.parentFolder = rootFolder;

        var displayFootage = importFileToFolder(displayFile, footageFolder);
        if (!displayFootage) {
            alert("Error: Display recording not found");
            return;
        }

        var webcamFootage = importFileToFolder(webcamFile, footageFolder);
        var sysAudioFootage = importFileToFolder(sysAudioFile, footageFolder);
        var micFootage = importFileToFolder(micFile, footageFolder);

        // Cursor
        var cursorDir = new Folder(recFolder.fsName + "/cursors");
        var cursorFile = null;
        var cursorHotSpotX = 4, cursorHotSpotY = 4;
        var cursorStandardW = 17, cursorStandardH = 23;

        var cursorsRaw = readJSON(recFolder.fsName + "/cursors.json");
        if (cursorsRaw) {
            // Can be array [{id, hotSpot, ...}] or dict {id: {hotSpot, ...}}
            var cursorsList;
            if (cursorsRaw instanceof Array) {
                cursorsList = cursorsRaw;
            } else {
                cursorsList = [];
                for (var cid in cursorsRaw) {
                    var ci = cursorsRaw[cid];
                    ci.id = cid;
                    cursorsList.push(ci);
                }
            }
            for (var i = 0; i < cursorsList.length; i++) {
                var cur = cursorsList[i];
                if (cur.id === "arrow" || !cursorFile) {
                    var cf = findFileByName(cursorDir, cur.id + ".png");
                    if (cf) cursorFile = cf;
                    if (cur.hotSpot) {
                        cursorHotSpotX = cur.hotSpot.x || 4;
                        cursorHotSpotY = cur.hotSpot.y || 4;
                    }
                    if (cur.standardSize) {
                        cursorStandardW = cur.standardSize.width || 17;
                        cursorStandardH = cur.standardSize.height || 23;
                    }
                }
            }
        } else if (cursorDir.exists) {
            cursorFile = findFileByName(cursorDir, "arrow.png");
        }

        var cursorFootage = importFileToFolder(cursorFile, footageFolder);

        // Get video dimensions from imported footage
        var displayW = displayFootage.width;
        var displayH = displayFootage.height;

        var webcamW = webcamFootage ? webcamFootage.width : 0;
        var webcamH = webcamFootage ? webcamFootage.height : 0;

        // ============================================================
        // 5. PROCESS MOUSE DATA
        // ============================================================
        var TARGET_FPS = 15;
        var rawMoves = readJSON(recFolder.fsName + "/mousemoves-0.json");
        if (!rawMoves) rawMoves = [];

        // Convert + downsample in one pass
        var mousePositions = [];
        var interval = 1.0 / TARGET_FPS;
        var lastT = -999;
        for (var i = 0; i < rawMoves.length; i++) {
            var m = rawMoves[i];
            var t = (m.processTimeMs - processTimeStart) / 1000.0;
            if (t < 0) continue;
            if (t - lastT < interval && i > 0 && i < rawMoves.length - 1) continue;

            var vx = (m.x - bounds.x) * (displayW / bounds.width);
            var vy = (m.y - bounds.y) * (displayH / bounds.height);
            vx = Math.max(0, Math.min(displayW, vx));
            vy = Math.max(0, Math.min(displayH, vy));
            mousePositions.push({ t: t, x: vx, y: vy });
            lastT = t;
        }

        // ============================================================
        // 6. PROCESS CLICK DATA
        // ============================================================
        var rawClicks = readJSON(recFolder.fsName + "/mouseclicks-0.json");
        if (!rawClicks) rawClicks = [];

        var clickTargets = [];
        for (var i = 0; i < rawClicks.length; i++) {
            var c = rawClicks[i];
            if (c.type !== "down") continue;
            var t = (c.processTimeMs - processTimeStart) / 1000.0;
            if (t < 0) continue;
            var vx = (c.x - bounds.x) * (displayW / bounds.width);
            var vy = (c.y - bounds.y) * (displayH / bounds.height);
            vx = Math.max(0, Math.min(displayW, vx));
            vy = Math.max(0, Math.min(displayH, vy));
            clickTargets.push({ t: t, x: vx, y: vy });
        }

        // ============================================================
        // 7. PROCESS ZOOM RANGES
        // ============================================================
        var zoomRanges = [];
        var scene = (proj.scenes && proj.scenes.length > 0) ? proj.scenes[0] : null;
        if (scene && scene.zoomRanges) {
            for (var i = 0; i < scene.zoomRanges.length; i++) {
                var zri = scene.zoomRanges[i];
                if (zri.isDisabled) continue;
                zoomRanges.push({
                    startTime: zri.startTime / 1000.0,
                    endTime: zri.endTime / 1000.0,
                    zoom: zri.zoom
                });
            }
        }

        // ============================================================
        // 8. BUILD COMPOSITION
        // ============================================================
        var compW = 1920;
        var compH = 1080;
        var compFps = 30;
        var compDur = Math.ceil(totalDuration) + 1;

        var mainComp = app.project.items.addComp(
            "SS - " + proj.name,
            compW, compH, 1, compDur, compFps
        );
        mainComp.parentFolder = rootFolder;
        mainComp.bgColor = [0, 0, 0];

        // Scale values
        var padRatio = (config.backgroundPaddingRatio || 10) / 100;
        var availW = compW * (1 - 2 * padRatio);
        var availH = compH * (1 - 2 * padRatio);
        var baseScale = Math.min(
            availW / displayW * 100,
            availH / displayH * 100
        );

        var zr = zoomRanges.length > 0 ? zoomRanges[0] : null;
        var zoomScale = zr ? baseScale * zr.zoom : baseScale;

        // --- Audio ---
        if (micFootage) {
            var micLayer = mainComp.layers.add(micFootage);
            micLayer.name = "Microphone";
        }
        if (sysAudioFootage) {
            var sysLayer = mainComp.layers.add(sysAudioFootage);
            sysLayer.name = "System Audio";
        }

        // --- Background ---
        var gradient = config.backgroundGradient || {};
        var stops = gradient.stops || [];
        var gradStartHex = (stops.length > 0) ? stops[0].color : (config.backgroundColor || "#000000");
        var gradEndHex = (stops.length > 1) ? stops[stops.length - 1].color : gradStartHex;

        var gradStart = hexToRGB(gradStartHex);
        var gradEnd = hexToRGB(gradEndHex);

        var bgLayer = mainComp.layers.addSolid(
            gradStart, "Background", compW, compH, 1
        );
        var bgEffects = bgLayer.property("ADBE Effect Parade");
        var ramp = bgEffects.addProperty("ADBE Ramp");
        ramp.property("ADBE Ramp-0001").setValue([0, 0]);
        ramp.property("ADBE Ramp-0002").setValue([gradStart[0], gradStart[1], gradStart[2], 1]);
        ramp.property("ADBE Ramp-0003").setValue([compW, compH]);
        ramp.property("ADBE Ramp-0004").setValue([gradEnd[0], gradEnd[1], gradEnd[2], 1]);
        ramp.property("ADBE Ramp-0005").setValue(1);

        // --- Screen Recording ---
        var screenLayer = mainComp.layers.add(displayFootage);
        screenLayer.name = "Screen Recording";

        var scrXf = screenLayer.property("ADBE Transform Group");
        var anchorX = displayW / 2;
        var anchorY = displayH / 2;
        scrXf.property("ADBE Anchor Point").setValue([anchorX, anchorY]);

        if (zr) {
            var scaleProp = scrXf.property("ADBE Scale");
            var zoomInDur = 0.5;
            var zoomOutDur = 0.5;

            var scaleTimes = [
                0,
                zr.startTime,
                zr.startTime + zoomInDur,
                zr.endTime - zoomOutDur,
                zr.endTime
            ];
            var scaleVals = [
                [baseScale, baseScale, 100],
                [baseScale, baseScale, 100],
                [zoomScale, zoomScale, 100],
                [zoomScale, zoomScale, 100],
                [baseScale, baseScale, 100]
            ];
            scaleProp.setValuesAtTimes(scaleTimes, scaleVals);

            for (var k = 1; k <= scaleProp.numKeys; k++) {
                applyEase(scaleProp, k, 75);
            }

            // Position keyframes: follow click targets during zoom
            var posProp = scrXf.property("ADBE Position");
            var centerPos = [compW / 2, compH / 2];

            var posTimes = [0, zr.startTime];
            var posVals = [centerPos, centerPos];

            var halfLW = displayW * zoomScale / 100 / 2;
            var halfLH = displayH * zoomScale / 100 / 2;

            var lastClickT = zr.startTime;
            for (var i = 0; i < clickTargets.length; i++) {
                var ct = clickTargets[i];
                if (ct.t < zr.startTime || ct.t > zr.endTime) continue;
                if (ct.t - lastClickT < 0.2) continue;

                var offsetX = (ct.x - anchorX) * (zoomScale / 100);
                var offsetY = (ct.y - anchorY) * (zoomScale / 100);
                var posX = centerPos[0] - offsetX;
                var posY = centerPos[1] - offsetY;

                posX = Math.max(compW - halfLW, Math.min(halfLW, posX));
                posY = Math.max(compH - halfLH, Math.min(halfLH, posY));

                posTimes.push(ct.t);
                posVals.push([posX, posY]);
                lastClickT = ct.t;
            }

            posTimes.push(zr.endTime);
            posVals.push(centerPos);

            posProp.setValuesAtTimes(posTimes, posVals);

            for (var k = 1; k <= posProp.numKeys; k++) {
                applyEase(posProp, k, 66);
                try {
                    posProp.setSpatialTangentsAtKey(k, [0, 0, 0], [0, 0, 0]);
                } catch(e4) {}
            }
        } else {
            scrXf.property("ADBE Scale").setValue([baseScale, baseScale, 100]);
            scrXf.property("ADBE Position").setValue([compW / 2, compH / 2]);
        }

        // Drop shadow
        var shadowIntensity = config.shadowIntensity != undefined ? config.shadowIntensity : 0.5;
        var scrEffects = screenLayer.property("ADBE Effect Parade");
        var scrShadow = scrEffects.addProperty("ADBE Drop Shadow");
        scrShadow.property("ADBE Drop Shadow-0002").setValue(Math.round(shadowIntensity * 255));
        scrShadow.property("ADBE Drop Shadow-0003").setValue(config.shadowAngle || 90);
        scrShadow.property("ADBE Drop Shadow-0004").setValue(config.shadowDistance || 10);
        scrShadow.property("ADBE Drop Shadow-0005").setValue(config.shadowBlur || 20);

        // Rounded corners mask
        var retinaFactor = displayW / bounds.width;
        var scrBorderR = (config.windowBorderRadius || 12) * retinaFactor;
        var scrMasks = screenLayer.property("ADBE Mask Parade");
        var scrMask = scrMasks.addProperty("ADBE Mask Atom");
        scrMask.property("ADBE Mask Shape").setValue(
            makeRoundedRect(displayW, displayH, scrBorderR)
        );

        // --- Webcam Overlay ---
        if (webcamFootage && !config.hideCamera) {
            var webcamLayer = mainComp.layers.add(webcamFootage);
            webcamLayer.name = "Webcam";

            var wcXf = webcamLayer.property("ADBE Transform Group");

            var camSize = config.cameraSize || 0.25;
            var camTargetW = compW * camSize;
            var wcScalePct = (camTargetW / webcamW) * 100;
            wcXf.property("ADBE Scale").setValue([wcScalePct, wcScalePct, 100]);

            var cpp = config.cameraPositionPoint || { x: 1, y: 1 };
            var wcPad = 40;
            var wcRendW = webcamW * wcScalePct / 100;
            var wcRendH = webcamH * wcScalePct / 100;

            var wcX = wcPad + wcRendW / 2 + cpp.x * (compW - wcRendW - 2 * wcPad);
            var wcY = wcPad + wcRendH / 2 + cpp.y * (compH - wcRendH - 2 * wcPad);
            wcXf.property("ADBE Position").setValue([wcX, wcY]);

            var minDim = Math.min(webcamW, webcamH);
            var wcCornerR = minDim * (config.cameraRoundness || 0.25) / 2;

            var wcMasks = webcamLayer.property("ADBE Mask Parade");
            var wcMask = wcMasks.addProperty("ADBE Mask Atom");
            wcMask.property("ADBE Mask Shape").setValue(makeRoundedRect(webcamW, webcamH, wcCornerR));

            var wcEffects = webcamLayer.property("ADBE Effect Parade");
            var wcShadow = wcEffects.addProperty("ADBE Drop Shadow");
            wcShadow.property("ADBE Drop Shadow-0002").setValue(128);
            wcShadow.property("ADBE Drop Shadow-0003").setValue(135);
            wcShadow.property("ADBE Drop Shadow-0004").setValue(10);
            wcShadow.property("ADBE Drop Shadow-0005").setValue(15);
        }

        // --- Mouse Data (hidden null with Point Control keyframes) ---
        var mouseNull = mainComp.layers.addNull();
        mouseNull.name = "Mouse Data";
        mouseNull.enabled = false;
        mouseNull.guideLayer = true;

        var mouseEffects = mouseNull.property("ADBE Effect Parade");
        var mouseXYCtrl = mouseEffects.addProperty("ADBE Point Control");
        mouseXYCtrl.name = "Mouse XY";
        var mouseXYProp = mouseXYCtrl.property("ADBE Point Control-0001");

        var mouseTimes = [];
        var mouseVals = [];
        for (var i = 0; i < mousePositions.length; i++) {
            mouseTimes.push(mousePositions[i].t);
            mouseVals.push([mousePositions[i].x, mousePositions[i].y]);
        }
        mouseXYProp.setValuesAtTimes(mouseTimes, mouseVals);

        for (var k = 1; k <= mouseXYProp.numKeys; k++) {
            mouseXYProp.setInterpolationTypeAtKey(k,
                KeyframeInterpolationType.LINEAR,
                KeyframeInterpolationType.LINEAR
            );
        }

        // --- Cursor Layer ---
        if (cursorFootage) {
            var cursorLayer = mainComp.layers.add(cursorFootage);
            cursorLayer.name = "Cursor";
            cursorLayer.moveToBeginning();

            var curXf = cursorLayer.property("ADBE Transform Group");

            curXf.property("ADBE Anchor Point").setValue([
                cursorHotSpotX, cursorHotSpotY, 0
            ]);

            var baseCursorScale = (config.cursorSize || 1.0) * cursorStandardW
                * retinaFactor / cursorFootage.width * 100;

            var scaleExpr = 'var screen = thisComp.layer("Screen Recording");\n'
                + 'var s = screen.transform.scale[0] / 100;\n'
                + 'var cs = ' + (Math.round(baseCursorScale * 100) / 100) + ' * s;\n'
                + '[cs, cs, 100]';
            curXf.property("ADBE Scale").expression = scaleExpr;

            var cursorExpr = 'var screen = thisComp.layer("Screen Recording");\n'
                + 'var mouse = thisComp.layer("Mouse Data").effect("Mouse XY")("Point");\n'
                + 'screen.toComp(mouse);';
            curXf.property("ADBE Position").expression = cursorExpr;
        }

        // ============================================================
        // 9. COMP SETTINGS
        // ============================================================
        mainComp.motionBlur = true;
        mainComp.workAreaStart = 0;
        mainComp.workAreaDuration = totalDuration;
        mainComp.openInViewer();

        // ============================================================
        // DONE
        // ============================================================
        alert("Screen Studio Import Complete\n\n"
            + "Comp: " + mainComp.name + "\n"
            + "Layers: " + mainComp.numLayers + "\n"
            + "Mouse keyframes: " + mousePositions.length + "\n"
            + "Click targets: " + clickTargets.length + "\n"
            + "Duration: " + totalDuration.toFixed(1) + "s");

    } catch (e) {
        alert("Screen Studio Import Error\n\n" + e.toString() + "\nLine: " + e.line);
    } finally {
        app.endUndoGroup();
    }
})();
