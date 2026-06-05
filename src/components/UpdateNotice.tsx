import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, Intent, ProgressBar, Spinner } from "@blueprintjs/core";
import { AppUpdateInfo, UpdateDownloadEvent } from "../types";

const CHECK_DELAY_MS = 1800;
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

type NoticePhase = "hidden" | "available" | "installing" | "ready" | "error";

function snoozeKey(version: string): string {
  return `chikku:update:snoozedUntil:${version}`;
}

function installedKey(version: string): string {
  return `chikku:update:installedPendingRestart:${version}`;
}

function isSnoozed(version: string): boolean {
  const value = localStorage.getItem(snoozeKey(version));
  if (!value) return false;
  const until = Number(value);
  if (!Number.isFinite(until) || until <= Date.now()) {
    localStorage.removeItem(snoozeKey(version));
    return false;
  }
  return true;
}

function isInstalledPendingRestart(version: string): boolean {
  return localStorage.getItem(installedKey(version)) === "true";
}

function formatDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function notesText(update: AppUpdateInfo): string {
  const body = update.body?.trim();
  return body || "Release notes were not provided for this update.";
}

export function UpdateNotice(): React.ReactElement | null {
  const [phase, setPhase] = useState<NoticePhase>("hidden");
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const claimedVersionRef = useRef<string | null>(null);

  const releaseClaim = useCallback((version: string | null) => {
    if (!version) return;
    claimedVersionRef.current = null;
    void window.api.releaseUpdateNotice(version).catch(() => {});
  }, []);

  useEffect(() => {
    if (!window.api?.checkForUpdate) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await window.api.checkForUpdate();
          if (cancelled || !found) return;
          if (isSnoozed(found.version) || isInstalledPendingRestart(found.version)) return;

          const claimed = await window.api.claimUpdateNotice(found.version);
          if (cancelled || !claimed) {
            if (claimed) releaseClaim(found.version);
            return;
          }

          claimedVersionRef.current = found.version;
          setUpdate(found);
          setPhase("available");
        } catch (err) {
          console.debug("Update check failed:", err);
        }
      })();
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      releaseClaim(claimedVersionRef.current);
    };
  }, [releaseClaim]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const version = update?.version;
      if (!version) return;
      if (
        event.key === snoozeKey(version)
        || event.key === installedKey(version)
      ) {
        releaseClaim(version);
        setPhase("hidden");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [releaseClaim, update]);

  const progress = useMemo(() => {
    if (!contentLength || contentLength <= 0) return undefined;
    return Math.max(0, Math.min(1, downloaded / contentLength));
  }, [contentLength, downloaded]);

  const formattedDate = useMemo(() => formatDate(update?.date ?? null), [update]);

  const handleInstall = useCallback(async () => {
    if (!update) return;
    setPhase("installing");
    setDetailsOpen(true);
    setDownloaded(0);
    setContentLength(null);
    setError(null);

    const onProgress = (event: UpdateDownloadEvent) => {
      if (event.event === "Started") {
        setDownloaded(0);
        setContentLength(event.data.contentLength ?? null);
      } else if (event.event === "Progress") {
        setDownloaded((prev) => prev + event.data.chunkLength);
      }
    };

    try {
      await window.api.installUpdate(onProgress);
      localStorage.setItem(installedKey(update.version), "true");
      setPhase("ready");
      releaseClaim(update.version);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [releaseClaim, update]);

  const handleSnooze = useCallback(() => {
    if (!update) return;
    localStorage.setItem(snoozeKey(update.version), String(Date.now() + SNOOZE_MS));
    releaseClaim(update.version);
    setPhase("hidden");
  }, [releaseClaim, update]);

  const handleLater = useCallback(() => {
    if (!update) return;
    releaseClaim(update.version);
    setPhase("hidden");
  }, [releaseClaim, update]);

  if (!update || phase === "hidden") return null;

  const versionLabel = `v${update.version}`;

  return (
    <div className={`update-notice update-notice-${phase}`}>
      <Button
        className="update-notice-chip"
        icon={phase === "ready" ? "refresh" : "automatic-updates"}
        text={phase === "ready" ? "Restart to finish update" : `${versionLabel} available`}
        small
        minimal
        intent={phase === "ready" ? Intent.SUCCESS : Intent.PRIMARY}
        onClick={() => setDetailsOpen((open) => !open)}
      />

      {detailsOpen && (
        <div className="update-notice-panel">
          <div className="update-notice-header">
            <div className="update-notice-title">
              <Icon icon={phase === "ready" ? "tick-circle" : "automatic-updates"} size={16} />
              <div>
                <strong>{phase === "ready" ? "Update installed" : "Update available"}</strong>
                <span>
                  {update.currentVersion} to {update.version}
                  {formattedDate ? ` | ${formattedDate}` : ""}
                </span>
              </div>
            </div>
            <Button
              icon="cross"
              minimal
              small
              title="Close update details"
              onClick={() => setDetailsOpen(false)}
            />
          </div>

          <div className="update-notice-body">
            <pre>{notesText(update)}</pre>
          </div>

          {phase === "installing" && (
            <div className="update-notice-progress">
              {progress === undefined ? (
                <Spinner size={16} />
              ) : (
                <ProgressBar value={progress} intent={Intent.PRIMARY} />
              )}
              <span>
                {contentLength
                  ? `${Math.min(downloaded, contentLength).toLocaleString()} of ${contentLength.toLocaleString()} bytes`
                  : "Downloading update..."}
              </span>
            </div>
          )}

          {phase === "error" && (
            <div className="update-notice-error">
              {error || "The update could not be installed."}
            </div>
          )}

          <div className="update-notice-actions">
            {phase === "ready" ? (
              <>
                <Button
                  intent={Intent.SUCCESS}
                  icon="refresh"
                  text="Restart now"
                  small
                  onClick={() => void window.api.restartApp()}
                />
                <Button text="Later" small onClick={handleLater} />
              </>
            ) : (
              <>
                <Button
                  intent={Intent.PRIMARY}
                  icon="download"
                  text={phase === "installing" ? "Updating..." : "Update"}
                  small
                  loading={phase === "installing"}
                  disabled={phase === "installing"}
                  onClick={handleInstall}
                />
                <Button
                  icon="time"
                  text="Remind me in 3 days"
                  small
                  disabled={phase === "installing"}
                  onClick={handleSnooze}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
