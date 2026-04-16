export type UserRole = 'admin' | 'user';

export interface Employee {
  employeeId: string;
  uid: string | null;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  joinedAt: string;
  hireDate: string;
  adjustment?: number;
  status?: 'active' | 'resigned';
}

export enum LeaveType {
  ANNUAL = 'ANNUAL',
  MORNING_HALF = 'MORNING_HALF',
  AFTERNOON_HALF = 'AFTERNOON_HALF',
  BONUS = 'BONUS',
  BONUS_MORNING_HALF = 'BONUS_MORNING_HALF',
  BONUS_AFTERNOON_HALF = 'BONUS_AFTERNOON_HALF',
  BIRTHDAY = 'BIRTHDAY',
  OFFICIAL = 'OFFICIAL',
}

export enum LeaveStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export interface BonusLeaveRecord {
  id: string;
  employeeId: string;
  employeeEmail?: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface CarriedOverRecord {
  id: string;
  employeeId: string;
  employeeEmail?: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeEmail?: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  reason: string;
  createdAt: string;
  processedBy?: string;
  processedAt?: string;
}

export interface LeaveBalance {
  accrued: number;
  carriedOver: number;
  bonus: number;
  usedAnnual: number;
  usedBonus: number;
  remainingAnnual: number;
  remainingBonus: number;
  totalRemaining: number;
}

export interface SystemSettings {
  slackWebhookUrl: string;
  useGoogleCalendar: boolean;
  googleCalendarId: string;
  lastBackupDate?: string;
}
