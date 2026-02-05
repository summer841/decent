
export enum Role {
  ADMIN = 'ADMIN',
  USER = 'USER'
}

export enum LeaveStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export enum LeaveType {
  ANNUAL = 'ANNUAL', // 일반 연차
  BONUS = 'BONUS',   // 보너스 연차
  MORNING_HALF = 'MORNING_HALF', // 오전 반차 (0.5일 차감)
  AFTERNOON_HALF = 'AFTERNOON_HALF', // 오후 반차 (0.5일 차감)
  BIRTHDAY = 'BIRTHDAY', // 생일 반차 (0일 차감)
  OFFICIAL = 'OFFICIAL' // 공결 (0일 차감)
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  hireDate: string; // ISO format
}

export interface BonusLeaveRecord {
  id: string;
  employeeId: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  reason: string;
  adminComment?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  employeeId: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface LeaveBalance {
  accrued: number;
  bonus: number;
  usedAnnual: number;
  usedBonus: number;
  remainingAnnual: number;
  remainingBonus: number;
}
