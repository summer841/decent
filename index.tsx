import React, { useState, useMemo, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  HashRouter as Router, 
  Routes, 
  Route, 
  Navigate, 
  Link, 
  useLocation 
} from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  Calendar, 
  LogOut, 
  PlusCircle, 
  MessageSquare, 
  History, 
  Menu, 
  X, 
  UserPlus, 
  ShieldCheck, 
  Award,
  Search,
  Edit2,
  TrendingUp,
  TrendingDown,
  FileText,
  Scale,
  Trash2,
  AlertTriangle,
  Settings,
  Bell, 
  Share2,
  Download,
  Upload,
  ChevronRight,
  RefreshCw
} from 'lucide-react';
import { 
  differenceInMonths, 
  differenceInYears, 
  addYears, 
  addMonths,
  isWithinInterval, 
  parseISO, 
  startOfDay,
  format,
  isWeekend,
  eachDayOfInterval,
  isValid,
  isAfter,
  subYears
} from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// --- 1. CONFIG & TYPES ---
const STORAGE_VER = 'v15'; 
const PREVIOUS_VERSIONS = ['v14', 'v13', 'v12', 'v11', 'v10', 'v9', 'v8', 'v7'];

enum Role { ADMIN = 'ADMIN', USER = 'USER' }
enum LeaveStatus { PENDING = 'PENDING', APPROVED = 'APPROVED', REJECTED = 'REJECTED', CANCELLED = 'CANCELLED' }
enum LeaveType {
  ANNUAL = 'ANNUAL',
  MORNING_HALF = 'MORNING_HALF',
  AFTERNOON_HALF = 'AFTERNOON_HALF',
  BONUS = 'BONUS',
  BONUS_MORNING_HALF = 'BONUS_MORNING_HALF',
  BONUS_AFTERNOON_HALF = 'BONUS_AFTERNOON_HALF',
  BIRTHDAY = 'BIRTHDAY',
  OFFICIAL = 'OFFICIAL',
}

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  [LeaveType.ANNUAL]: '연차',
  [LeaveType.MORNING_HALF]: '오전 반차',
  [LeaveType.AFTERNOON_HALF]: '오후 반차',
  [LeaveType.BONUS]: '보너스 연차',
  [LeaveType.BONUS_MORNING_HALF]: '보너스 오전 반차',
  [LeaveType.BONUS_AFTERNOON_HALF]: '보너스 오후 반차',
  [LeaveType.BIRTHDAY]: '생일 반차',
  [LeaveType.OFFICIAL]: '공결',
};

const STATUS_LABELS: Record<LeaveStatus, string> = {
  [LeaveStatus.PENDING]: '대기',
  [LeaveStatus.APPROVED]: '승인',
  [LeaveStatus.REJECTED]: '반려',
  [LeaveStatus.CANCELLED]: '취소됨',
};

interface Employee { 
  id: string; 
  name: string; 
  email: string; 
  password: string; 
  role: Role; 
  hireDate: string; 
  lastSyncYear?: number; 
}
interface BonusLeaveRecord { id: string; employeeId: string; amount: number; reason: string; createdAt: string; }
interface CarriedOverRecord { id: string; employeeId: string; amount: number; reason: string; createdAt: string; }
interface LeaveRequest { 
  id: string; employeeId: string; type: LeaveType; startDate: string; endDate: string; 
  startTime?: string; endTime?: string; isAllDay: boolean; status: LeaveStatus; reason: string; createdAt: string; 
}
interface LeaveBalance { 
  accrued: number; 
  carriedOver: number;
  bonus: number; 
  usedAnnual: number; 
  usedBonus: number; 
  remainingAnnual: number; 
  remainingBonus: number; 
}
interface SystemSettings { slackWebhookUrl: string; useGoogleCalendar: boolean; googleCalendarId: string; }
interface UnifiedHistoryItem { id: string; date: string; type: 'EARNED' | 'USED' | 'SYSTEM'; category: string; amount: number; reason: string; status?: LeaveStatus; detail?: string; }

// --- 2. UTILS ---
const calculateWorkdays = (start: Date, end: Date): number => {
  if (!isValid(start) || !isValid(end) || start > end) return 0;
  try {
    const days = eachDayOfInterval({ start, end });
    return days.filter(day => !isWeekend(day)).length;
  } catch { return 0; }
};

const calculateUsedInRange = (requests: LeaveRequest[], startRange: Date, endRange: Date) => {
  let used = 0;
  requests.forEach(req => {
    if (req.status !== LeaveStatus.APPROVED) return;
    const leaveStart = parseISO(req.startDate);
    const leaveEnd = parseISO(req.endDate);
    
    if (isWithinInterval(leaveStart, { start: startOfDay(startRange), end: startOfDay(endRange) })) {
      const workdays = calculateWorkdays(leaveStart, leaveEnd);
      let deduction = 0;
      const isHalfDay = [LeaveType.MORNING_HALF, LeaveType.AFTERNOON_HALF, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);
      const isFree = [LeaveType.OFFICIAL, LeaveType.BIRTHDAY].includes(req.type);
      const isBonusSource = [LeaveType.BONUS, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);

      if (isFree || isBonusSource) deduction = 0; 
      else if (isHalfDay) deduction = workdays * 0.5; 
      else deduction = workdays;
      
      used += deduction;
    }
  });
  return used;
};

const getEmployeeLeaveBalance = (
  hireDateStr: string, 
  requests: LeaveRequest[], 
  bonusRecords: BonusLeaveRecord[],
  carriedOverRecords: CarriedOverRecord[]
): LeaveBalance => {
  const today = new Date();
  const hireDate = parseISO(hireDateStr);
  const yearsSinceHire = differenceInYears(today, hireDate);
  const cycleStart = addYears(hireDate, yearsSinceHire);
  const finalCycleStart = cycleStart > today ? addYears(hireDate, yearsSinceHire - 1) : cycleStart;
  const cycleEnd = addYears(finalCycleStart, 1);
  const totalMonths = differenceInMonths(today, hireDate);
  
  let accrued = yearsSinceHire < 1 ? Math.min(totalMonths, 11) : Math.min(15 + Math.floor((yearsSinceHire - 1) / 2), 25);
  const carriedOver = carriedOverRecords.reduce((sum, r) => sum + r.amount, 0);
  const bonus = bonusRecords.reduce((sum, r) => sum + r.amount, 0);
  
  let usedAnnual = 0, usedBonus = 0;
  requests.forEach(req => {
    if (req.status !== LeaveStatus.APPROVED) return;
    const start = parseISO(req.startDate);
    const workdays = calculateWorkdays(start, parseISO(req.endDate));
    let deduction = 0;
    const isHalfDay = [LeaveType.MORNING_HALF, LeaveType.AFTERNOON_HALF, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);
    const isFree = [LeaveType.OFFICIAL, LeaveType.BIRTHDAY].includes(req.type);
    
    if (isFree) deduction = 0; 
    else if (isHalfDay) deduction = workdays * 0.5; 
    else deduction = workdays;
    
    if (isWithinInterval(start, { start: startOfDay(finalCycleStart), end: startOfDay(cycleEnd) })) {
      const isBonusSource = [LeaveType.BONUS, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);
      isBonusSource ? usedBonus += deduction : usedAnnual += deduction;
    }
  });
  
  return { 
    accrued, 
    carriedOver,
    bonus, 
    usedAnnual, 
    usedBonus, 
    remainingAnnual: Number((accrued + carriedOver - usedAnnual).toFixed(1)), 
    remainingBonus: Number((bonus - usedBonus).toFixed(1)) 
  };
};

const getUnifiedHistory = (employee: Employee, requests: LeaveRequest[], bonusRecords: BonusLeaveRecord[], carriedOverRecords: CarriedOverRecord[]): UnifiedHistoryItem[] => {
  const history: UnifiedHistoryItem[] = [];
  const hireDate = parseISO(employee.hireDate);
  const today = new Date();
  const yearsSinceHire = differenceInYears(today, hireDate);
  
  if (yearsSinceHire < 1) {
    const months = Math.min(differenceInMonths(today, hireDate), 11);
    for (let i = 1; i <= months; i++) {
      history.push({ id: `accrual-m-${i}`, date: format(addMonths(hireDate, i), 'yyyy-MM-dd'), type: 'EARNED', category: '연차', amount: 1, reason: '1년 미만 근속에 따른 월차 발생' });
    }
  } else {
    for (let i = 1; i <= yearsSinceHire; i++) {
      const amt = Math.min(15 + Math.floor((i - 1) / 2), 25);
      history.push({ id: `accrual-y-${i}`, date: format(addYears(hireDate, i), 'yyyy-MM-dd'), type: 'EARNED', category: '연차', amount: amt, reason: `${i}년차 정기 연차 발생` });
    }
  }
  
  carriedOverRecords.forEach(cr => {
    history.push({ id: cr.id, date: format(parseISO(cr.createdAt), 'yyyy-MM-dd'), type: 'EARNED', category: '이월 연차', amount: cr.amount, reason: cr.reason });
  });

  bonusRecords.forEach(br => { 
    history.push({ id: br.id, date: format(parseISO(br.createdAt), 'yyyy-MM-dd'), type: 'EARNED', category: '보너스 연차', amount: br.amount, reason: br.reason }); 
  });

  requests.forEach(req => {
    if (req.status === LeaveStatus.CANCELLED) return;
    const workdays = calculateWorkdays(parseISO(req.startDate), parseISO(req.endDate));
    let deduction = 0;
    const isHalfDay = [LeaveType.MORNING_HALF, LeaveType.AFTERNOON_HALF, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);
    const isFree = [LeaveType.OFFICIAL, LeaveType.BIRTHDAY].includes(req.type);
    if (isFree) deduction = 0; else if (isHalfDay) deduction = workdays * 0.5; else deduction = workdays;
    history.push({ id: req.id, date: req.startDate, type: 'USED', category: LEAVE_TYPE_LABELS[req.type], amount: deduction, reason: req.reason, status: req.status, detail: `${req.startDate} ~ ${req.endDate} ${req.isAllDay ? '(종일)' : `(${req.startTime}~${req.endTime})`}` });
  });
  return history.sort((a, b) => isAfter(parseISO(b.date), parseISO(a.date)) ? 1 : -1);
};

const askGemini = async (prompt: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview', 
      contents: prompt,
      config: { 
        systemInstruction: "당신은 인사 관리 AI입니다. 한국어로 친절하게 요약해서 답하세요." 
      }
    });
    return response.text;
  } catch (error) { 
    console.error('Gemini error:', error); 
    return "AI 분석 정보를 가져올 수 없습니다."; 
  }
};

const loadWithMigration = (key: string, defaultVal: any) => {
  const current = localStorage.getItem(`sl_${key}_${STORAGE_VER}`);
  if (current) return JSON.parse(current);
  for (const ver of PREVIOUS_VERSIONS) {
    const prev = localStorage.getItem(`sl_${key}_${ver}`);
    if (prev) {
      const data = JSON.parse(prev);
      localStorage.setItem(`sl_${key}_${STORAGE_VER}`, prev);
      return data;
    }
  }
  return defaultVal;
};

const INITIAL_EMPLOYEES: Employee[] = [
  { id: 'admin-main', name: '최세영', email: 'summer@decentlaw.io', password: 'Injeolmi97', role: Role.ADMIN, hireDate: '2020-01-01', lastSyncYear: 0 },
];

export default function App() {
  const [user, setUser] = useState<Employee | null>(() => loadWithMigration('user', null));
  const [employees, setEmployees] = useState<Employee[]>(() => loadWithMigration('employees', INITIAL_EMPLOYEES));
  const [requests, setRequests] = useState<LeaveRequest[]>(() => loadWithMigration('requests', []));
  const [bonusRecords, setBonusRecords] = useState<BonusLeaveRecord[]>(() => loadWithMigration('bonus', []));
  const [carriedOverRecords, setCarriedOverRecords] = useState<CarriedOverRecord[]>(() => loadWithMigration('carried_over', []));
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(() => loadWithMigration('settings', { slackWebhookUrl: '', useGoogleCalendar: false, googleCalendarId: '' }));
  
  const [searchTerm, setSearchTerm] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<Employee | null>(null);
  const [isBonusModalOpen, setIsBonusModalOpen] = useState<{empId: string, name: string} | null>(null);
  const [isCarriedModalOpen, setIsCarriedModalOpen] = useState<{empId: string, name: string} | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<Employee | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string, type: 'EMPLOYEE' | 'REQUEST' | 'BONUS' | 'CARRIED' } | null>(null);

  useEffect(() => { localStorage.setItem(`sl_user_${STORAGE_VER}`, JSON.stringify(user)); }, [user]);
  useEffect(() => { localStorage.setItem(`sl_employees_${STORAGE_VER}`, JSON.stringify(employees)); }, [employees]);
  useEffect(() => { localStorage.setItem(`sl_requests_${STORAGE_VER}`, JSON.stringify(requests)); }, [requests]);
  useEffect(() => { localStorage.setItem(`sl_bonus_${STORAGE_VER}`, JSON.stringify(bonusRecords)); }, [bonusRecords]);
  useEffect(() => { localStorage.setItem(`sl_carried_over_${STORAGE_VER}`, JSON.stringify(carriedOverRecords)); }, [carriedOverRecords]);
  useEffect(() => { localStorage.setItem(`sl_settings_${STORAGE_VER}`, JSON.stringify(systemSettings)); }, [systemSettings]);

  const autoSyncCarriedOver = useCallback(() => {
    const today = new Date();
    let updatedCarriedRecords = [...carriedOverRecords];
    let updatedEmployees = [...employees];
    let syncDetected = false;

    updatedEmployees = updatedEmployees.map(emp => {
      const hireDate = parseISO(emp.hireDate);
      const currentYearsSinceHire = differenceInYears(today, hireDate);
      const lastSyncYear = emp.lastSyncYear ?? 0;

      if (currentYearsSinceHire > lastSyncYear) {
        for (let targetYear = lastSyncYear + 1; targetYear <= currentYearsSinceHire; targetYear++) {
          const prevCycleStart = addYears(hireDate, targetYear - 1);
          const prevCycleEnd = addYears(hireDate, targetYear);
          
          let prevAccrued = 0;
          if (targetYear === 1) { 
            prevAccrued = Math.min(differenceInMonths(prevCycleEnd, hireDate), 11);
          } else {
            prevAccrued = Math.min(15 + Math.floor((targetYear - 2) / 2), 25);
          }

          const usedInPrevCycle = calculateUsedInRange(requests.filter(r => r.employeeId === emp.id), prevCycleStart, prevCycleEnd);
          const leftover = Math.max(0, prevAccrued - usedInPrevCycle);

          if (leftover > 0) {
            const exists = updatedCarriedRecords.some(r => r.id === `auto-${emp.id}-${targetYear}`);
            if (!exists) {
              updatedCarriedRecords.push({
                id: `auto-${emp.id}-${targetYear}`,
                employeeId: emp.id,
                amount: Number(leftover.toFixed(1)),
                reason: `${targetYear - 1}년차 잔여 연차 자동 이월`,
                createdAt: today.toISOString()
              });
              syncDetected = true;
            }
          }
        }
        return { ...emp, lastSyncYear: currentYearsSinceHire };
      }
      return emp;
    });

    if (syncDetected) {
      setCarriedOverRecords(updatedCarriedRecords);
      setEmployees(updatedEmployees);
    }
  }, [employees, carriedOverRecords, requests]);

  useEffect(() => {
    autoSyncCarriedOver();
  }, [autoSyncCarriedOver]);

  const handleLogin = (email: string, pass: string) => {
    const found = employees.find(e => e.email === email && e.password === pass);
    if (found) setUser(found);
    else alert('이메일 또는 비밀번호가 일치하지 않습니다.');
  };

  const handleLogout = () => { setUser(null); };

  const handleUpdateEmployee = (updatedEmp: Employee) => {
    const originalEmp = employees.find(e => e.id === updatedEmp.id);
    if (originalEmp && originalEmp.hireDate !== updatedEmp.hireDate) {
      updatedEmp.lastSyncYear = 0;
      setCarriedOverRecords(prev => prev.filter(r => !(r.employeeId === updatedEmp.id && r.id.startsWith('auto-'))));
    }
    setEmployees(prev => prev.map(emp => emp.id === updatedEmp.id ? updatedEmp : emp));
    if (user?.id === updatedEmp.id) setUser(updatedEmp);
    setIsEditModalOpen(null);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const { id, type } = pendingDelete;
    if (type === 'EMPLOYEE') {
      if (id === user?.id) alert('본인 계정은 삭제할 수 없습니다.');
      else {
        setEmployees(prev => prev.filter(emp => emp.id !== id));
        setRequests(prev => prev.filter(req => req.employeeId !== id));
        setBonusRecords(prev => prev.filter(rec => rec.employeeId !== id));
        setCarriedOverRecords(prev => prev.filter(rec => rec.employeeId !== id));
      }
    } else if (type === 'REQUEST') {
      setRequests(prev => prev.filter(req => req.id !== id));
    } else if (type === 'BONUS') {
      setBonusRecords(prev => prev.filter(rec => rec.id !== id));
    } else if (type === 'CARRIED') {
      setCarriedOverRecords(prev => prev.filter(rec => rec.id !== id));
    }
    setPendingDelete(null);
  };

  const handleBackup = () => {
    const data = { employees, requests, bonusRecords, carriedOverRecords, systemSettings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decent_leave_backup_${format(new Date(), 'yyyyMMdd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.employees) setEmployees(data.employees);
        if (data.requests) setRequests(data.requests);
        if (data.bonusRecords) setBonusRecords(data.bonusRecords);
        if (data.carriedOverRecords) setCarriedOverRecords(data.carriedOverRecords);
        if (data.systemSettings) setSystemSettings(data.systemSettings);
        alert('데이터 복구가 완료되었습니다.');
      } catch (err) { alert('잘못된 백업 파일입니다.'); }
    };
    reader.readAsText(file);
  };

  const handleSubmitRequest = async (formData: any, isEdit = false) => {
    if (!user) return;
    if (isEdit) {
      // 팩트: formData에 id가 포함되어야 함
      setRequests(p => p.map(req => req.id === formData.id 
        ? { ...req, ...formData, status: LeaveStatus.PENDING, updatedAt: new Date().toISOString() } 
        : req
      ));
    } else {
      const newRequest: LeaveRequest = { 
        ...formData, 
        id: Math.random().toString(36).substr(2, 9), 
        status: LeaveStatus.PENDING, 
        employeeId: user.id, 
        createdAt: new Date().toISOString() 
      };
      setRequests(p => [...p, newRequest]);
    }
  };

  const handleApproveRequest = async (requestId: string) => { setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: LeaveStatus.APPROVED } : r)); };
  const filteredEmployees = useMemo(() => employees.filter(emp => emp.name.toLowerCase().includes(searchTerm.toLowerCase())), [employees, searchTerm]);

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <Router>
      <div className="flex h-screen bg-[#F1F5F9] overflow-hidden text-slate-800 antialiased">
        <Sidebar user={user} onLogout={handleLogout} isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="bg-white border-b px-4 py-3 md:hidden flex justify-between items-center z-30">
            <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-slate-100 rounded-lg"><Menu size={18}/></button>
            <span className="font-bold text-blue-600 text-sm">디센트 휴가시스템</span>
            <div className="w-8"/>
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
              <Routes>
                <Route path="/dashboard" element={<Dashboard employee={user} requests={requests} bonusRecords={bonusRecords.filter(b => b.employeeId === user.id)} carriedOverRecords={carriedOverRecords.filter(c => c.employeeId === user.id)} onSubmitRequest={handleSubmitRequest} onDeleteRequest={(id: string) => setPendingDelete({id, type: 'REQUEST'})} />} />
                <Route path="/history" element={<HistoryView employee={user} requests={requests.filter(r => r.employeeId === user.id)} bonusRecords={bonusRecords.filter(b => b.employeeId === user.id)} carriedOverRecords={carriedOverRecords.filter(c => c.employeeId === user.id)} />} />
                {user.role === Role.ADMIN && (
                  <>
                    <Route path="/admin/employees" element={
                      <div className="space-y-6 animate-in fade-in duration-400">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-baseline gap-3"><h2 className="text-xl font-bold text-slate-900">직원 현황</h2><span className="text-xs font-bold text-slate-400 px-2 py-0.5 bg-slate-100 rounded-full">총 {employees.length}명</span></div>
                          <div className="flex items-center gap-2">
                            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12}/><input type="text" placeholder="이름 검색..." className="pl-8 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
                            <button onClick={() => setIsInviteModalOpen(true)} className="bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 hover:bg-blue-600 transition-all shadow-sm"><UserPlus size={14}/> 신규 등록</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {filteredEmployees.map(emp => {
                            const bal = getEmployeeLeaveBalance(
                              emp.hireDate, 
                              requests.filter(r => r.employeeId === emp.id), 
                              bonusRecords.filter(b => b.employeeId === emp.id),
                              carriedOverRecords.filter(c => c.employeeId === emp.id)
                            );
                            return (
                              <div key={emp.id} className="bg-white px-3 py-2.5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-blue-200 transition-all group">
                                <div className="flex items-center gap-2.5 min-w-[200px]">
                                  <div className="w-10 h-10 bg-slate-50 text-slate-400 rounded-lg flex items-center justify-center font-bold text-sm group-hover:bg-blue-600 group-hover:text-white transition-all">{emp.name[0]}</div>
                                  <div className="min-w-0"><div className="flex items-center gap-1 font-bold text-slate-900 text-[13px] truncate">{emp.name} {emp.role === Role.ADMIN && <ShieldCheck size={11} className="text-blue-500"/>}</div><p className="text-[10px] text-slate-400 font-medium truncate">입사: {emp.hireDate}</p></div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 flex-1 justify-start md:justify-center">
                                  <AdminStat label="법정 발생" value={bal.accrued} color="text-slate-900" />
                                  <AdminStat label="이월 연차" value={bal.carriedOver} color="text-indigo-500" />
                                  <AdminStat label="보너스" value={bal.bonus} color="text-amber-600" />
                                  <AdminStat label="잔여 연차" value={bal.remainingAnnual} color="text-blue-600" />
                                  <AdminStat label="잔여 보너스" value={bal.remainingBonus} color="text-indigo-600" />
                                </div>
                                <div className="flex items-center gap-1 border-l md:pl-2 border-slate-100">
                                  <button onClick={() => setIsHistoryModalOpen(emp)} className="p-2 text-slate-400 hover:text-indigo-600" title="히스토리"><FileText size={16}/></button>
                                  <button onClick={() => setIsEditModalOpen(emp)} className="p-2 text-slate-400 hover:text-blue-600" title="수정"><Edit2 size={16}/></button>
                                  <button onClick={() => setPendingDelete({id: emp.id, type: 'EMPLOYEE'})} className="p-2 text-slate-400 hover:text-red-500" title="삭제"><Trash2 size={16}/></button>
                                  <div className="flex flex-col gap-0.5 ml-1">
                                    <button onClick={() => setIsCarriedModalOpen({empId: emp.id, name: emp.name})} className="bg-indigo-50 text-indigo-500 px-1.5 py-1 rounded-md font-bold text-[8px] hover:bg-indigo-600 hover:text-white transition-all border border-indigo-100">이월</button>
                                    <button onClick={() => setIsBonusModalOpen({empId: emp.id, name: emp.name})} className="bg-slate-50 text-slate-500 px-1.5 py-1 rounded-md font-bold text-[8px] hover:bg-slate-900 hover:text-white transition-all border border-slate-100">보너스</button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    } />
                    <Route path="/admin/requests" element={<AdminRequestView requests={requests} onDelete={(id: string) => setPendingDelete({id, type: 'REQUEST'})} onApprove={handleApproveRequest} setRequests={setRequests} employees={employees} />} />
                    <Route path="/admin/settings" element={<SettingsView settings={systemSettings} onSave={setSystemSettings} onBackup={handleBackup} onRestore={handleRestore} />} />
                  </>
                )}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>

      {isInviteModalOpen && <EmployeeModal onClose={() => setIsInviteModalOpen(false)} onSave={(emp: Employee) => { setEmployees(p => [...p, emp]); setIsInviteModalOpen(false); }} />}
      {isEditModalOpen && <EmployeeModal initialData={isEditModalOpen} onClose={() => setIsEditModalOpen(null)} onSave={handleUpdateEmployee} onDelete={(id: string) => setPendingDelete({id, type: 'EMPLOYEE'})} />}
      
      {isBonusModalOpen && (
        <GenericRecordModal 
          title="보너스 연차 관리"
          target={isBonusModalOpen} 
          records={bonusRecords.filter(b => b.employeeId === isBonusModalOpen.empId)}
          onClose={() => setIsBonusModalOpen(null)} 
          onAdd={(rec: any) => setBonusRecords(p => [...p, rec])}
          onDeleteRecord={(id: string) => setPendingDelete({id, type: 'BONUS'})}
          accentColor="blue"
        />
      )}

      {isCarriedModalOpen && (
        <GenericRecordModal 
          title="이월 연차 관리"
          target={isCarriedModalOpen} 
          records={carriedOverRecords.filter(c => c.employeeId === isCarriedModalOpen.empId)}
          onClose={() => setIsCarriedModalOpen(null)} 
          onAdd={(rec: any) => setCarriedOverRecords(p => [...p, rec])}
          onDeleteRecord={(id: string) => setPendingDelete({id, type: 'CARRIED'})}
          accentColor="indigo"
        />
      )}

      {pendingDelete && <DeleteConfirmModal type={pendingDelete.type} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />}
      
      {isHistoryModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden max-h-[85vh] flex flex-col">
             <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
               <h3 className="font-bold text-sm">{isHistoryModalOpen.name}님의 상세 연차 기록</h3>
               <button onClick={() => setIsHistoryModalOpen(null)}><X size={20}/></button>
             </div>
             <div className="flex-1 overflow-y-auto p-4">
               <HistoryView 
                  employee={isHistoryModalOpen} 
                  requests={requests.filter(r => r.employeeId === isHistoryModalOpen.id)} 
                  bonusRecords={bonusRecords.filter(b => b.employeeId === isHistoryModalOpen.id)} 
                  carriedOverRecords={carriedOverRecords.filter(c => c.employeeId === isHistoryModalOpen.id)} 
                  isModal={true} 
               />
             </div>
          </div>
        </div>
      )}
    </Router>
  );
}

// --- SUB COMPONENTS ---
const DeleteConfirmModal = ({ type, onCancel, onConfirm }: any) => (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white w-full max-sm rounded-2xl shadow-2xl p-6 text-center space-y-5 animate-in zoom-in duration-200">
      <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto"><AlertTriangle size={32}/></div>
      <div>
        <h4 className="text-lg font-bold">정말 삭제하시겠습니까?</h4>
        <p className="text-sm text-slate-500 mt-2">
          {type === 'EMPLOYEE' ? '모든 정보와 연차 기록이 삭제되며 되돌릴 수 없습니다.' : 
           type === 'BONUS' ? '해당 보너스 연차 지급 내역이 삭제됩니다.' : 
           type === 'CARRIED' ? '해당 이월 연차 기록이 삭제됩니다.' : '해당 연차 신청 내역이 삭제됩니다.'}
        </p>
      </div>
      <div className="flex gap-3"><button onClick={onCancel} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm">취소</button><button onClick={onConfirm} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold text-sm">삭제하기</button></div>
    </div>
  </div>
);

const GenericRecordModal = ({ title, target, records, onClose, onAdd, onDeleteRecord, accentColor }: any) => {
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState('');
  const total = useMemo(() => records.reduce((sum: number, r: any) => sum + r.amount, 0), [records]);
  const btnBg = accentColor === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-blue-600 hover:bg-blue-700';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b flex justify-between items-center bg-slate-50 shrink-0">
          <div>
            <h3 className="font-bold text-sm text-slate-900">{target.name}님 {title}</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">합계: {total}일</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors"><X size={20}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <section className="space-y-3">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-2">기존 내역</h4>
            <div className="space-y-2">
              {records.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs italic bg-slate-50 rounded-2xl border border-dashed font-medium">내역이 없습니다.</div>
              ) : records.map((rec: any) => (
                <div key={rec.id} className="flex items-center justify-between p-3.5 bg-white border border-slate-100 rounded-2xl hover:border-blue-100 transition-all group">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${accentColor === 'indigo' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>+{rec.amount}</div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{rec.reason}</p>
                      <p className="text-[9px] text-slate-400 font-medium">{rec.createdAt.split('T')[0]}</p>
                    </div>
                  </div>
                  <button onClick={() => onDeleteRecord(rec.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"><Trash2 size={14}/></button>
                </div>
              ))}
            </div>
          </section>
          <section className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-5">
            <h4 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest text-center">신규 추가</h4>
            <div className="flex items-center justify-center gap-6">
              <button type="button" onClick={() => setAmount(Math.max(0.5, amount - 0.5))} className="w-10 h-10 rounded-xl bg-white border text-slate-600 text-xl font-black hover:bg-slate-100 transition-all shadow-sm">-</button>
              <div className="text-3xl font-black text-slate-900 w-20 text-center">{amount}일</div>
              <button type="button" onClick={() => setAmount(amount + 0.5)} className={`w-10 h-10 rounded-xl text-white text-xl font-black transition-all shadow-lg ${btnBg}`}>+</button>
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">사유</label>
              <textarea required className="w-full border-2 border-white p-4 rounded-xl text-xs font-medium bg-white h-24 resize-none focus:border-blue-500 outline-none transition-all shadow-sm" value={reason} onChange={e => setReason(e.target.value)} placeholder="사유를 입력하세요..." />
            </div>
            <button 
              onClick={() => {
                if(!reason.trim()) { alert('사유를 입력해주세요.'); return; }
                onAdd({ id: Math.random().toString(36).substr(2, 9), employeeId: target.empId, amount, reason, createdAt: new Date().toISOString() });
                setReason(''); setAmount(1);
              }} 
              className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition-all shadow-xl shadow-slate-200"
            >
              내역 추가하기
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};

const LoginScreen = ({ onLogin }: any) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-xs text-center space-y-6 border">
        <div className="space-y-2"><div className="w-12 h-12 bg-blue-600 rounded-xl mx-auto flex items-center justify-center text-white text-2xl font-bold">D</div><h1 className="text-lg font-bold">디센트 휴가시스템</h1></div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onLogin(email, password); }}>
          <input type="email" required className="w-full bg-slate-50 border p-3 rounded-xl text-sm outline-none" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" required className="w-full bg-slate-50 border p-3 rounded-xl text-sm outline-none" placeholder="비밀번호" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-sm">로그인</button>
        </form>
      </div>
    </div>
  );
};

const Sidebar = ({ user, onLogout, isOpen, setIsOpen }: any) => {
  const loc = useLocation();
  const NavItem = ({ to, icon: Icon, label }: any) => (
    <Link to={to} onClick={() => setIsOpen(false)} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl transition-all ${loc.pathname === to ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}><Icon size={16} /><span className="text-xs font-bold">{label}</span></Link>
  );
  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsOpen(false)} />}
      <div className={`fixed inset-y-0 left-0 z-50 w-60 bg-white border-r flex flex-col p-4 transition-transform md:relative md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2 mb-8 px-2"><div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shrink-0">D</div><h1 className="text-sm font-bold tracking-tight">디센트 휴가시스템</h1></div>
        <nav className="flex-1 space-y-1">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="대시보드" /><NavItem to="/history" icon={History} label="연차 히스토리" />
          {user.role === Role.ADMIN && (<div className="pt-6 space-y-1"><p className="text-[10px] font-bold text-slate-400 uppercase px-3 mb-2">Admin</p><NavItem to="/admin/employees" icon={Users} label="직원 관리" /><NavItem to="/admin/requests" icon={Calendar} label="연차 승인" /><NavItem to="/admin/settings" icon={Settings} label="시스템 설정" /></div>)}
        </nav>
        <div className="mt-auto pt-4 border-t">
          <div className="px-2 mb-3"><div className="flex items-center gap-1.5"><p className="text-xs font-bold truncate">{user.name}</p>{user.role === Role.ADMIN && <ShieldCheck size={12} className="text-blue-500"/>}</div><p className="text-[10px] text-slate-400 truncate">{user.email}</p></div>
          <button onClick={onLogout} className="flex items-center gap-2 w-full px-3.5 py-2.5 text-red-500 text-xs font-bold hover:bg-red-50 rounded-xl transition-all"><LogOut size={16}/>로그아웃</button>
        </div>
      </div>
    </>
  );
};

const Dashboard = ({ employee, requests, bonusRecords, carriedOverRecords, onSubmitRequest, onDeleteRequest }: any) => {
  const myRequests = useMemo(() => requests.filter((r:any) => r.employeeId === employee.id && r.status !== LeaveStatus.CANCELLED), [requests, employee.id]);
  const balance = useMemo(() => getEmployeeLeaveBalance(
    employee.hireDate, 
    myRequests.filter((r:any) => r.status === LeaveStatus.APPROVED), 
    bonusRecords,
    carriedOverRecords
  ), [employee.hireDate, myRequests, bonusRecords, carriedOverRecords]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null);
  const [aiRes, setAiRes] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ type: LeaveType.ANNUAL, startDate: format(new Date(), 'yyyy-MM-dd'), endDate: format(new Date(), 'yyyy-MM-dd'), isAllDay: true, startTime: '09:00', endTime: '18:00', reason: '' });

  return (
    <div className="space-y-6 animate-in fade-in duration-400">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border shadow-sm">
        <div><h2 className="text-xl font-bold">{employee.name}님, 좋은 하루입니다</h2><p className="text-xs text-slate-500 mt-1">입사일: {employee.hireDate} • 법정 발생 및 이월 연차가 포함된 잔여 연차입니다.</p></div>
        <button onClick={() => { setEditingRequest(null); setForm({ type: LeaveType.ANNUAL, startDate: format(new Date(), 'yyyy-MM-dd'), endDate: format(new Date(), 'yyyy-MM-dd'), isAllDay: true, startTime: '09:00', endTime: '18:00', reason: '' }); setIsModalOpen(true); }} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all"><PlusCircle size={18}/>연차 신청</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="법정 발생" value={`${balance.accrued}일`} icon={Scale} />
        <StatCard label="이월 연차" value={`${balance.carriedOver}일`} icon={RefreshCw} color="text-indigo-500" />
        <StatCard label="보너스 연차" value={`${balance.bonus}일`} icon={Award} color="text-amber-600" />
        <StatCard label="잔여 연차" value={`${balance.remainingAnnual}일`} color="text-blue-600" sub="(발생+이월)-사용" />
        <StatCard label="잔여 보너스" value={`${balance.remainingBonus}일`} color="text-indigo-600" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1"><div className="bg-white p-6 rounded-2xl border shadow-sm flex flex-col h-full"><div className="flex items-center gap-2 mb-3 text-blue-600 font-bold text-xs uppercase tracking-widest"><MessageSquare size={16}/> AI 연차 분석</div>{aiRes ? <div className="text-xs bg-slate-50 p-4 rounded-xl mb-4 leading-relaxed text-slate-700 border border-slate-100 whitespace-pre-wrap">{aiRes}</div> : <p className="text-slate-400 mb-4 text-xs font-medium leading-relaxed">직원님의 연차 현황을 분석하여 휴식 일정을 추천해드립니다.</p>}<button disabled={loading} onClick={async () => { setLoading(true); const res = await askGemini(`직원 ${employee.name} (입사일: ${employee.hireDate})의 현재 잔여 연차(이월 포함)는 ${balance.remainingAnnual}일입니다. 분석해주세요.`); setAiRes(res || ''); setLoading(false); }} className="w-full bg-slate-50 text-slate-700 py-2.5 rounded-xl font-bold text-xs hover:bg-slate-100 border mt-auto">{loading ? '분석 중...' : '연차 분석 요청 →'}</button></div></div>
        <div className="lg:col-span-2"><div className="bg-white rounded-2xl border shadow-sm overflow-hidden"><div className="px-6 py-4 border-b bg-slate-50/50 flex justify-between items-center"><h3 className="font-bold text-[10px] text-slate-400 uppercase tracking-widest">최근 신청 현황</h3><Link to="/history" className="text-[10px] font-bold text-blue-600 hover:underline">전체 보기</Link></div><div className="overflow-x-auto"><table className="w-full text-left text-[11px]"><thead className="bg-slate-50 text-slate-400 font-bold border-b"><tr><th className="px-6 py-3 uppercase">종류</th><th className="px-6 py-3 uppercase">기간</th><th className="px-6 py-3 uppercase">상태</th><th className="px-6 py-3 text-right uppercase">관리</th></tr></thead><tbody className="divide-y divide-slate-100">{myRequests.length === 0 ? <tr><td colSpan={4} className="px-6 py-16 text-center text-slate-400 italic">내역이 없습니다.</td></tr> : myRequests.slice(0, 10).map((req: LeaveRequest) => (<tr key={req.id} className="hover:bg-slate-50/30 group"><td className="px-6 py-3.5 font-bold text-slate-800">{LEAVE_TYPE_LABELS[req.type]}</td><td className="px-6 py-3.5 text-slate-500">{req.startDate}{req.startDate !== req.endDate ? ` ~ ${req.endDate}` : ''}</td><td className="px-6 py-3.5"><span className={`inline-flex px-2 py-0.5 rounded-full font-bold text-[9px] ${req.status === LeaveStatus.APPROVED ? 'bg-emerald-50 text-emerald-600' : req.status === LeaveStatus.REJECTED ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>{STATUS_LABELS[req.status]}</span></td><td className="px-6 py-3.5 text-right"><div className="flex items-center justify-end gap-1 opacity-20 group-hover:opacity-100 transition-opacity">
        <button onClick={() => { setEditingRequest(req); setForm({ type: req.type, startDate: req.startDate, endDate: req.endDate, isAllDay: req.isAllDay, startTime: req.startTime || '09:00', endTime: req.endTime || '18:00', reason: req.reason }); setIsModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-blue-600"><Edit2 size={13}/></button><button onClick={() => onDeleteRequest(req.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={13}/></button></div></td></tr>))}</tbody></table></div></div></div>
      </div>
      {isModalOpen && (<div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in duration-200"><div className="flex justify-between items-center border-b pb-4"><h3 className="font-bold text-sm text-slate-900">연차 {editingRequest ? '수정' : '신청'}</h3><button onClick={() => setIsModalOpen(false)}><X size={18}/></button></div><div className="space-y-4"><div className="space-y-1.5"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">종류</label><select className="w-full border p-2.5 rounded-xl text-sm font-bold bg-slate-50" value={form.type} onChange={e => setForm({...form, type: e.target.value as LeaveType})}>{Object.entries(LEAVE_TYPE_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}</select></div><div className="flex items-center gap-2"><input type="checkbox" id="all-day" checked={form.isAllDay} onChange={e => setForm({...form, isAllDay: e.target.checked})} className="w-4 h-4 rounded text-blue-600"/><label htmlFor="all-day" className="text-sm font-bold text-slate-600">종일 신청</label></div><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">시작일</label><input type="date" className="w-full border p-2 rounded-lg text-xs font-bold" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})}/></div><div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">종료일</label><input type="date" className="w-full border p-2 rounded-lg text-xs font-bold" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})}/></div></div><div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">사유</label><textarea required className="w-full border p-3 rounded-xl text-xs font-medium bg-slate-50 h-24 resize-none" value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} placeholder="신청 사유..."/></div><button onClick={() => { 
        const submitData = editingRequest ? { ...form, id: editingRequest.id } : form;
        onSubmitRequest(submitData, !!editingRequest); 
        setIsModalOpen(false); 
      }} className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-100">{editingRequest ? '수정하기' : '신청하기'}</button></div></div></div>)}
    </div>
  );
};

const StatCard = ({ label, value, sub, icon: Icon, color = "text-slate-900" }: any) => (
  <div className="bg-white p-4 rounded-2xl border shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
    <div className="flex items-center justify-between mb-2">
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
      {Icon && <Icon size={14} className="text-slate-200" />}
    </div>
    <div>
      <div className={`text-xl font-black ${color}`}>{value}</div>
      {sub && <p className="text-[8px] text-slate-400 font-bold mt-0.5">{sub}</p>}
    </div>
  </div>
);

const AdminStat = ({ label, value, color = "text-slate-500" }: any) => (
  <div className="px-2 py-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col items-center min-w-[65px] group-hover:bg-white transition-all flex-1">
    <span className="text-[8px] font-bold text-slate-400 uppercase mb-0.5 tracking-tighter text-center">{label}</span>
    <span className={`text-[11px] font-black ${color}`}>{value}</span>
  </div>
);

const HistoryView = ({ employee, requests, bonusRecords, carriedOverRecords, isModal = false }: any) => {
  const history = useMemo(() => getUnifiedHistory(employee, requests, bonusRecords, carriedOverRecords), [employee, requests, bonusRecords, carriedOverRecords]);
  return (
    <div className={`space-y-4 ${!isModal ? 'animate-in fade-in duration-400' : ''}`}>
      {!isModal && <h2 className="text-xl font-bold text-slate-900 mb-6 px-1">전체 연차 히스토리</h2>}
      <div className="space-y-2.5">{history.length === 0 ? <div className="text-center py-20 text-slate-400 text-xs italic bg-white rounded-2xl border border-dashed font-bold">기록된 연차 변동 내역이 없습니다.</div> : history.map(item => (<div key={item.id} className="bg-white p-4 rounded-2xl border shadow-sm flex items-center justify-between hover:shadow-md transition-all"><div className="flex items-center gap-4"><div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.type === 'EARNED' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>{item.type === 'EARNED' ? <TrendingUp size={20}/> : <TrendingDown size={20}/>}</div><div><div className="flex items-center gap-2"><span className="text-sm font-bold text-slate-800">{item.category}</span><span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${item.type === 'EARNED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{item.type === 'EARNED' ? '+' : '-'}{item.amount}일</span></div><p className="text-xs text-slate-400 mt-0.5">{item.reason}</p></div></div><div className="text-right"><div className="text-xs font-black text-slate-400 mb-1">{item.date}</div>{item.status && <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${item.status === LeaveStatus.APPROVED ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500'}`}>{STATUS_LABELS[item.status]}</span>}</div></div>))}</div>
    </div>
  );
};

const AdminRequestView = ({ requests, onApprove, onDelete, setRequests, employees }: any) => {
  const handleReject = (id: string) => setRequests((prev: any) => prev.map((r: any) => r.id === id ? { ...r, status: LeaveStatus.REJECTED } : r));
  const pendingRequests = useMemo(() => requests.filter((r: any) => r.status === LeaveStatus.PENDING), [requests]);
  return (
    <div className="space-y-6 animate-in fade-in duration-400"><div className="flex items-center justify-between"><h2 className="text-xl font-bold text-slate-900">대기 중인 연차 승인</h2><span className="px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-xs font-bold border border-amber-100">미처리 {pendingRequests.length}건</span></div><div className="space-y-3">{pendingRequests.length === 0 ? <div className="bg-white p-20 text-center rounded-3xl border border-dashed text-slate-400 text-sm font-bold">모든 요청이 처리되었습니다.</div> : pendingRequests.map((req: any) => { const emp = employees.find((e: any) => e.id === req.employeeId); return (<div key={req.id} className="bg-white p-5 rounded-2xl border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5 transition-all hover:shadow-md"><div className="flex items-center gap-4"><div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-black text-lg">{emp?.name[0]}</div><div><div className="flex items-center gap-2.5 mb-1"><span className="text-sm font-black text-slate-900">{emp?.name}</span><span className="text-[10px] font-bold px-2 py-1 bg-slate-100 rounded-lg text-slate-600 uppercase tracking-tight">{LEAVE_TYPE_LABELS[req.type as LeaveType]}</span></div><p className="text-xs text-slate-500 font-bold">{req.startDate} ~ {req.endDate}</p><p className="text-[11px] text-slate-400 italic">" {req.reason} "</p></div></div><div className="flex items-center gap-2"><button type="button" onClick={() => onDelete(req.id)} className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={20}/></button><button onClick={() => handleReject(req.id)} className="px-5 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold">반려</button><button onClick={() => onApprove(req.id)} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-100">즉시 승인</button></div></div>); })}</div></div>
  );
};

const SettingsView = ({ settings, onSave, onBackup, onRestore }: any) => {
  const [form, setForm] = useState(settings);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-6 animate-in fade-in duration-400">
      <div className="flex items-center gap-3 mb-6"><h2 className="text-xl font-bold text-slate-900">시스템 설정</h2><Settings size={24} className="text-slate-300"/></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-6"><div className="flex items-center gap-3 text-slate-900 font-bold border-b pb-4 border-slate-50"><Bell size={20} className="text-blue-500"/>Slack 알림 연동</div><div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Webhook URL</label><input type="text" className="w-full border-2 border-slate-100 p-3.5 rounded-2xl text-xs bg-slate-50 focus:border-blue-500 outline-none transition-all" placeholder="https://hooks.slack.com/services/..." value={form.slackWebhookUrl} onChange={e => setForm({...form, slackWebhookUrl: e.target.value})} /></div></div>
        <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-6"><div className="flex items-center gap-3 text-slate-900 font-bold border-b pb-4 border-slate-50"><Share2 size={20} className="text-emerald-500"/>캘린더 동기화</div><div className="flex items-center justify-between py-2"><span className="text-sm font-bold text-slate-600">Google Calendar 연동</span><button onClick={() => setForm({...form, useGoogleCalendar: !form.useGoogleCalendar})} className={`w-12 h-6 rounded-full relative transition-all ${form.useGoogleCalendar ? 'bg-emerald-500' : 'bg-slate-200'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${form.useGoogleCalendar ? 'right-1' : 'left-1'}`}/></button></div></div>
      </div>
      
      <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-6 animate-in slide-in-from-bottom-2">
        <div className="flex items-center gap-3 text-slate-900 font-bold border-b pb-4 border-slate-50"><Scale size={20} className="text-amber-500"/>데이터 관리 및 패치 보존</div>
        <div className="flex flex-col md:flex-row gap-4">
          <button onClick={onBackup} className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-50 text-slate-700 rounded-2xl font-bold text-sm hover:bg-slate-100 border-2 border-slate-100 transition-all"><Download size={18}/>전체 데이터 백업 (JSON)</button>
          <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-50 text-slate-700 rounded-2xl font-bold text-sm hover:bg-slate-100 border-2 border-slate-100 transition-all"><Upload size={18}/>백업 데이터 복구하기</button>
          <input type="file" ref={fileInputRef} onChange={onRestore} className="hidden" accept=".json" />
        </div>
        <p className="text-[11px] text-slate-400 font-medium">※ 시스템 업데이트 후 데이터가 보이지 않는 경우, 저장해둔 백업 파일을 통해 즉시 복구가 가능합니다.</p>
      </div>

      <div className="flex justify-end pt-4"><button onClick={() => { onSave(form); alert('저장되었습니다.'); }} className="bg-slate-900 text-white px-8 py-3.5 rounded-2xl font-bold text-sm hover:bg-blue-600 transition-all shadow-xl shadow-slate-200">설정 저장하기</button></div>
    </div>
  );
};

const EmployeeModal = ({ initialData, onClose, onSave, onDelete }: any) => {
  const [form, setForm] = useState(initialData || { name: '', email: '', password: '', role: Role.USER, hireDate: format(new Date(), 'yyyy-MM-dd') });
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4"><div className="bg-white w-full max-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in duration-200"><div className="px-6 py-5 border-b flex justify-between items-center bg-slate-50"><h3 className="font-bold text-sm text-slate-900">직원 정보 {initialData ? '수정' : '등록'}</h3><button onClick={onClose}><X size={20}/></button></div><form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); onSave(initialData ? { ...initialData, ...form } : { ...form, id: Math.random().toString(36).substr(2, 9) }); }}><div className="space-y-1.5"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">이름</label><input required className="w-full border-2 border-slate-100 p-3 rounded-xl text-sm font-bold outline-none focus:border-blue-500" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div><div className="space-y-1.5"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">이메일</label><input required type="email" className="w-full border-2 border-slate-100 p-3 rounded-xl text-sm font-bold outline-none focus:border-blue-500" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-1.5"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">비밀번호</label><input required className="w-full border-2 border-slate-100 p-3 rounded-xl text-sm font-bold outline-none" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div><div className="space-y-1.5"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">입사일</label><input type="date" className="w-full border-2 border-slate-100 p-3 rounded-xl text-xs font-bold" value={form.hireDate} onChange={e => setForm({ ...form, hireDate: e.target.value })} /></div></div><div className="pt-6 flex flex-col gap-3"><button type="submit" className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-100 transition-all">정보 저장</button>{initialData && <button type="button" onClick={() => onDelete(initialData.id)} className="w-full py-3.5 bg-white text-red-500 border-2 border-red-50 rounded-2xl font-bold text-sm hover:bg-red-50 flex items-center justify-center gap-2"><Trash2 size={18}/>직원 삭제</button>}</div></form></div></div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);