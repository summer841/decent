
import { 
  differenceInMonths, 
  differenceInYears, 
  addYears, 
  isWithinInterval, 
  parseISO, 
  startOfDay,
  addDays,
  differenceInCalendarDays,
  format,
  isWeekend,
  eachDayOfInterval
} from 'date-fns';
import { LeaveType, LeaveRequest, LeaveStatus, BonusLeaveRecord, LeaveBalance } from '../types';

/**
 * 두 날짜 사이의 평일(월-금) 수를 계산합니다.
 */
export const calculateWorkdays = (start: Date, end: Date): number => {
  if (start > end) return 0;
  try {
    const days = eachDayOfInterval({ start, end });
    return days.filter(day => !isWeekend(day)).length;
  } catch (e) {
    return 0;
  }
};

/**
 * 입사일 기준으로 현재 주기를 계산합니다.
 */
export const getCurrentCycle = (hireDateStr: string, today: Date = new Date()) => {
  const hireDate = parseISO(hireDateStr);
  const yearsSinceHire = differenceInYears(today, hireDate);
  const cycleStart = addYears(hireDate, yearsSinceHire);
  
  // 만약 오늘이 올해 입사기념일 전이라면 작년 주기로 계산
  if (cycleStart > today) {
    const prevStart = addYears(hireDate, yearsSinceHire - 1);
    return {
      start: startOfDay(prevStart),
      end: startOfDay(addYears(prevStart, 1)),
      tenureYears: yearsSinceHire - 1
    };
  }

  return {
    start: startOfDay(cycleStart),
    end: startOfDay(addYears(cycleStart, 1)),
    tenureYears: yearsSinceHire
  };
};

/**
 * 입사일 기준 현재 주기(1년) 내에 발생한 연차를 계산합니다.
 * - 1년 미만: 1개월 만근 시 1개 (최대 11개)
 * - 1년 이상: 15개 기본
 * - 3년 차(근속 2년 초과)부터: 2년마다 1일씩 가산 (최대 25일)
 */
export const calculateAccruedInCycle = (hireDateStr: string, today: Date = new Date()) => {
  const hireDate = parseISO(hireDateStr);
  const totalMonths = differenceInMonths(today, hireDate);
  const yearsSinceHire = differenceInYears(today, hireDate);

  // 1년 미만: 1개월 만근 시 1개씩 (최대 11개)
  if (yearsSinceHire < 1) {
    return Math.min(totalMonths, 11);
  }

  // 1년 이상: 기본 15개 + 가산 연차 계산
  const additionalDays = Math.floor((yearsSinceHire - 1) / 2);
  const totalAccrued = 15 + additionalDays;

  return Math.min(totalAccrued, 25);
};

/**
 * 사용자의 전체 연차 밸런스를 계산합니다.
 */
export const getEmployeeLeaveBalance = (
  hireDateStr: string,
  requests: LeaveRequest[],
  bonusRecords: BonusLeaveRecord[]
): LeaveBalance => {
  const today = new Date();
  const cycle = getCurrentCycle(hireDateStr, today);
  
  // 1. 이번 주기 발생 연차 (가산 연차 포함)
  const accrued = calculateAccruedInCycle(hireDateStr, today);

  // 2. 해당 직원의 보너스 연차 총합
  const bonus = bonusRecords
    .reduce((sum, r) => sum + r.amount, 0);

  // 3. 이번 주기 내 사용한 연차/보너스 (승인된 것만)
  let usedAnnual = 0;
  let usedBonus = 0;

  requests.forEach(req => {
    if (req.status !== LeaveStatus.APPROVED) return;

    const start = parseISO(req.startDate);
    const end = parseISO(req.endDate);
    
    // 평일만 계산 (주말 제외)
    const workdays = calculateWorkdays(start, end);
    let deduction = workdays;

    // 차감 가중치 계산
    if (req.type === LeaveType.MORNING_HALF || req.type === LeaveType.AFTERNOON_HALF) {
      deduction = workdays * 0.5;
    } else if (req.type === LeaveType.BIRTHDAY || req.type === LeaveType.OFFICIAL) {
      deduction = 0;
    }

    // 이번 주기 내에 포함되는지 확인 (시작일 기준)
    if (isWithinInterval(start, { start: cycle.start, end: cycle.end })) {
      if (req.type === LeaveType.BONUS) {
        usedBonus += deduction;
      } else {
        // ANNUAL, MORNING_HALF, AFTERNOON_HALF 등은 모두 일반 연차 한도에서 차감
        usedAnnual += deduction;
      }
    }
  });

  return {
    accrued,
    bonus,
    usedAnnual,
    usedBonus,
    remainingAnnual: Math.max(0, accrued - usedAnnual),
    remainingBonus: Math.max(0, bonus - usedBonus)
  };
};
