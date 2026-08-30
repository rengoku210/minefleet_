export interface ScheduleDefinition {
  id: string;
  machineId: string | null;
  groupId: string | null;
  name: string;
  cronExpression: string | null;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  days: string[];    // ['mon', 'tue', ...]
  configOverride: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const ALL_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const WEEKENDS: DayOfWeek[] = ['sat', 'sun'];
