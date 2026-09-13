import { Capacitor, registerPlugin } from '@capacitor/core';
import type { TrackingCorrection, TrackingSnapshot } from './openroundSmartTracking';

export const nativeTrackingAvailable = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
export const nativeTracking = registerPlugin<{
  start(options: {roundID: string; courseID: string; hole: number}): Promise<TrackingSnapshot>;
  stop(): Promise<TrackingSnapshot>;
  snapshot(options?: {sessionID?: string}): Promise<TrackingSnapshot>;
  correct(options: TrackingCorrection & {sessionID: string}): Promise<TrackingSnapshot>;
}>('SmartTracking');
