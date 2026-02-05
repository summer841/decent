
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
  CheckCircle,
  XCircle,
  Lock,
  Mail,
  Eye,
  EyeOff,
  Gift,
  Briefcase,
  Clock,
  Search,
  User,
  Edit2,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  FileText,
  Scale
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
  isBefore
} from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// --- 1. TYPES ---
enum Role { ADMIN = 'ADMIN', USER = 'USER' }
enum LeaveStatus { PENDING = 'PENDING', APPROVED = 'APPROVED', REJECTED = 'REJECTED' }
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
  [LeaveType.ANNUAL]: '일반 연차',
  [LeaveType.MORNING_HALF]: '오전 반차',
  [LeaveType.AFTERNOON_HALF]: '오후 반차',
  [LeaveType.BONUS]: '보너스 연차',
  [LeaveType.BONUS_MORNING_HALF]: '보너스 오전 반차',
  [LeaveType.BONUS_AFTERNOON_HALF]: '보너스 오후 반차',
  [LeaveType.BIRTHDAY]: '생일 반차',
  [LeaveType.OFFICIAL]: '공결',
};

interface Employee { 
  id: string; 
  name: string; 
  email: string; 
  password: string; 
  role: Role; 
  hireDate: string; 
}
interface BonusLeaveRecord { id: string; employeeId: string; amount: number; reason: string; createdAt: string; }
interface LeaveRequest { 
  id: string; 
  employeeId: string; 
  type: LeaveType; 
  startDate: string; 
  endDate: string; 
  startTime?: string; 
  endTime?: string; 
  isAllDay: boolean;
  status: LeaveStatus; 
  reason: string; 
  createdAt: string; 
}
interface LeaveBalance { accrued: number; bonus: number; usedAnnual: number; usedBonus: number; remainingAnnual: number; remainingBonus: number; }

interface UnifiedHistoryItem {
  id: string;
  date: string;
  type: 'EARNED' | 'USED' | 'SYSTEM';
  category: string;
  amount: number;
  reason: string;
  status?: LeaveStatus;
  detail?: string;
}

// --- 2. UTILS ---
const calculateWorkdays = (start: Date, end: Date): number => {
  if (!isValid(start) || !isValid(end) || start > end) return 0;
  try {
    const days = eachDayOfInterval({ start, end });
    return days.filter(day => !isWeekend(day)).length;
  } catch { return 0; }
};

const getEmployeeLeaveBalance = (
  hireDateStr: string,
  requests: LeaveRequest[],
  bonusRecords: BonusLeaveRecord[]
): LeaveBalance => {
  const today = new Date();
  const hireDate = parseISO(hireDateStr);
  const yearsSinceHire = differenceInYears(today, hireDate);
  const cycleStart = addYears(hireDate, yearsSinceHire);
  const finalCycleStart = cycleStart > today ? addYears(hireDate, yearsSinceHire - 1) : cycleStart;
  const cycleEnd = addYears(finalCycleStart, 1);

  const totalMonths = differenceInMonths(today, hireDate);
  let accrued = yearsSinceHire < 1 ? Math.min(totalMonths, 11) : Math.min(15 + Math.floor((yearsSinceHire - 1) / 2), 25);
  
  const bonus = bonusRecords.reduce((sum, r) => sum + r.amount, 0);

  let usedAnnual = 0, usedBonus = 0;
  requests.forEach(req => {
    if (req.status !== LeaveStatus.APPROVED) return;
    const start = parseISO(req.startDate);
    const workdays = calculateWorkdays(start, parseISO(req.endDate));
    
    let deduction = 0;
    const isHalfDay = [LeaveType.MORNING_HALF, LeaveType.AFTERNOON_HALF, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);
    const isFree = [LeaveType.OFFICIAL, LeaveType.BIRTHDAY].includes(req.type);

    if (isFree) {
      deduction = 0; 
    } else if (isHalfDay) {
      deduction = workdays * 0.5; 
    } else {
      deduction = workdays;
    }

    if (isWithinInterval(start, { start: startOfDay(finalCycleStart), end: startOfDay(cycleEnd) })) {
      const isBonusSource = [LeaveType.BONUS, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);
      isBonusSource ? usedBonus += deduction : usedAnnual += deduction;
    }
  });

  return {
    accrued, bonus, usedAnnual, usedBonus,
    remainingAnnual: Number((accrued - usedAnnual).toFixed(1)),
    remainingBonus: Number((bonus - usedBonus).toFixed(1))
  };
};

const getUnifiedHistory = (employee: Employee, requests: LeaveRequest[], bonusRecords: BonusLeaveRecord[]): UnifiedHistoryItem[] => {
  const history: UnifiedHistoryItem[] = [];
  const hireDate = parseISO(employee.hireDate);
  const today = new Date();

  // 1. 자동 발생 연차 (Accruals)
  const yearsSinceHire = differenceInYears(today, hireDate);
  if (yearsSinceHire < 1) {
    const months = Math.min(differenceInMonths(today, hireDate), 11);
    for (let i = 1; i <= months; i++) {
      history.push({
        id: `accrual-m-${i}`,
        date: format(addMonths(hireDate, i), 'yyyy-MM-dd'),
        type: 'EARNED',
        category: '일반 연차',
        amount: 1,
        reason: '1년 미만 근속에 따른 월차 발생'
      });
    }
  } else {
    for (let i = 1; i <= yearsSinceHire; i++) {
      const amt = Math.min(15 + Math.floor((i - 1) / 2), 25);
      history.push({
        id: `accrual-y-${i}`,
        date: format(addYears(hireDate, i), 'yyyy-MM-dd'),
        type: 'EARNED',
        category: '일반 연차',
        amount: amt,
        reason: `${i}년차 정기 연차 발생`
      });
    }
  }

  // 2. 보너스 연차 발생
  bonusRecords.forEach(br => {
    history.push({
      id: br.id,
      date: format(parseISO(br.createdAt), 'yyyy-MM-dd'),
      type: 'EARNED',
      category: '보너스 연차',
      amount: br.amount,
      reason: br.reason
    });
  });

  // 3. 사용 내역
  requests.forEach(req => {
    const workdays = calculateWorkdays(parseISO(req.startDate), parseISO(req.endDate));
    let deduction = 0;
    const isHalfDay = [LeaveType.MORNING_HALF, LeaveType.AFTERNOON_HALF, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);
    const isFree = [LeaveType.OFFICIAL, LeaveType.BIRTHDAY].includes(req.type);

    if (isFree) deduction = 0;
    else if (isHalfDay) deduction = workdays * 0.5;
    else deduction = workdays;

    history.push({
      id: req.id,
      date: req.startDate,
      type: 'USED',
      category: LEAVE_TYPE_LABELS[req.type],
      amount: deduction,
      reason: req.reason,
      status: req.status,
      detail: `${req.startDate} ~ ${req.endDate} ${req.isAllDay ? '(종일)' : `(${req.startTime}~${req.endTime})`}`
    });
  });

  return history.sort((a, b) => isAfter(parseISO(b.date), parseISO(a.date)) ? 1 : -1);
};

const askGemini = async (prompt: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { systemInstruction: "당신은 인사 관리 AI입니다. 한국어로 친절하게 요약해서 답하세요." }
    });
    return response.text;
  } catch (error) { 
    console.error('Gemini error:', error);
    return "AI 분석 정보를 가져올 수 없습니다."; 
  }
};

// --- 3. INITIAL DATA ---
const INITIAL_EMPLOYEES: Employee[] = [
  { 
    id: 'admin-main', 
    name: '최세영', 
    email: 'summer@decentlaw.io', 
    password: 'Injeolmi97', 
    role: Role.ADMIN, 
    hireDate: '2020-01-01' 
  },
];

// --- 4. MAIN APP ---
export default function App() {
  const [user, setUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('sl_user_v7');
    return saved ? JSON.parse(saved) : null;
  });
  const [employees, setEmployees] = useState<Employee[]>(() => {
    const saved = localStorage.getItem('sl_employees_v7');
    return saved ? JSON.parse(saved) : INITIAL_EMPLOYEES;
  });
  const [requests, setRequests] = useState<LeaveRequest[]>(() => {
    const saved = localStorage.getItem('sl_requests_v7');
    return saved ? JSON.parse(saved) : [];
  });
  const [bonusRecords, setBonusRecords] = useState<BonusLeaveRecord[]>(() => {
    const saved = localStorage.getItem('sl_bonus_v7');
    return saved ? JSON.parse(saved) : [];
  });
  const [searchTerm, setSearchTerm] = useState('');
  
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<Employee | null>(null);
  const [isBonusModalOpen, setIsBonusModalOpen] = useState<{empId: string, name: string} | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<Employee | null>(null);

  useEffect(() => { localStorage.setItem('sl_user_v7', JSON.stringify(user)); }, [user]);
  useEffect(() => { localStorage.setItem('sl_employees_v7', JSON.stringify(employees)); }, [employees]);
  useEffect(() => { localStorage.setItem('sl_requests_v7', JSON.stringify(requests)); }, [requests]);
  useEffect(() => { localStorage.setItem('sl_bonus_v7', JSON.stringify(bonusRecords)); }, [bonusRecords]);

  const handleLogin = (email: string, pass: string) => {
    const found = employees.find(e => e.email === email && e.password === pass);
    if (found) {
      setUser(found);
    } else {
      alert('이메일 또는 비밀번호가 일치하지 않습니다.');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('sl_user_v7');
  };

  const handleUpdateEmployee = (updatedEmp: Employee) => {
    setEmployees(prev => prev.map(emp => emp.id === updatedEmp.id ? updatedEmp : emp));
    if (user?.id === updatedEmp.id) setUser(updatedEmp);
    setIsEditModalOpen(null);
  };

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => emp.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [employees, searchTerm]);

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <Router>
      <div className="flex h-screen bg-[#F1F5F9] overflow-hidden text-slate-800 antialiased font-sans">
        <Sidebar user={user} onLogout={handleLogout} isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="bg-white/80 backdrop-blur-md border-b px-4 py-3 md:hidden flex justify-between items-center z-30 shadow-sm">
            <button onClick={() => setSidebarOpen(true)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"><Menu size={18}/></button>
            <span className="font-bold text-blue-600 text-lg tracking-tight">디센트 휴가시스템</span>
            <div className="w-8"/>
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
              <Routes>
                <Route path="/dashboard" element={<Dashboard employee={user} requests={requests} bonusRecords={bonusRecords.filter(b => b.employeeId === user.id)} onAddRequest={(d: any) => setRequests(p => [...p, { ...d, id: Math.random().toString(36).substr(2, 9), status: LeaveStatus.PENDING, employeeId: user.id, createdAt: new Date().toISOString() }])} />} />
                <Route path="/history" element={<HistoryView employee={user} requests={requests.filter(r => r.employeeId === user.id)} bonusRecords={bonusRecords.filter(b => b.employeeId === user.id)} />} />
                {user.role === Role.ADMIN && (
                  <>
                    <Route path="/admin/employees" element={
                      <div className="space-y-6 animate-in fade-in duration-400">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-baseline gap-3">
                            <h2 className="text-xl font-bold text-slate-900">직원 현황</h2>
                            <span className="text-xs font-bold text-slate-400 px-2 py-0.5 bg-slate-100 rounded-full">Total {employees.length}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12}/>
                              <input type="text" placeholder="검색..." className="pl-8 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-blue-500 w-36 md:w-48 transition-all shadow-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                            </div>
                            <button onClick={() => setIsInviteModalOpen(true)} className="bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 hover:bg-blue-600 transition-all shadow-sm whitespace-nowrap">
                              <UserPlus size={14}/> 등록
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {filteredEmployees.map(emp => {
                            const empRequests = requests.filter(r => r.employeeId === emp.id);
                            const empBonus = bonusRecords.filter(b => b.employeeId === emp.id);
                            const bal = getEmployeeLeaveBalance(emp.hireDate, empRequests, empBonus);
                            return (
                              <div key={emp.id} className="bg-white px-3 py-2.5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-blue-200 transition-all group">
                                <div className="flex items-center gap-2.5 min-w-[180px]">
                                  <div className="w-8 h-8 bg-slate-50 text-slate-400 rounded-lg flex items-center justify-center font-bold text-sm group-hover:bg-blue-600 group-hover:text-white transition-all">{emp.name[0]}</div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1 font-bold text-slate-900 text-[13px] truncate">{emp.name} {emp.role === Role.ADMIN && <ShieldCheck size={11} className="text-blue-500"/>}</div>
                                    <p className="text-[9px] text-slate-400 font-medium truncate">{emp.email}</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 flex-1 justify-start md:justify-center">
                                  <AdminStat label="법정 발생" value={bal.accrued} color="text-slate-900" />
                                  <AdminStat label="보너스 발생" value={bal.bonus} color="text-amber-600" />
                                  <AdminStat label="사용" value={bal.usedAnnual + bal.usedBonus} />
                                  <AdminStat label="잔여 연차" value={bal.remainingAnnual} color="text-blue-600" />
                                  <AdminStat label="잔여 보너스" value={bal.remainingBonus} color="text-indigo-600" />
                                </div>
                                <div className="flex items-center gap-1 border-l md:pl-2 border-slate-100">
                                  <button onClick={() => setIsHistoryModalOpen(emp)} title="히스토리" className="p-1.5 text-slate-300 hover:text-indigo-600 transition-all"><FileText size={15}/></button>
                                  <button onClick={() => setIsEditModalOpen(emp)} title="수정" className="p-1.5 text-slate-300 hover:text-blue-600 transition-all"><Edit2 size={15}/></button>
                                  <button onClick={() => setIsBonusModalOpen({empId: emp.id, name: emp.name})} className="bg-slate-50 text-slate-500 px-2 py-1 rounded-md font-bold text-[9px] hover:bg-slate-900 hover:text-white transition-all border border-slate-100">보너스</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    } />
                    <Route path="/admin/requests" element={<AdminRequestView requests={requests} setRequests={setRequests} employees={employees} />} />
                  </>
                )}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>

      {isInviteModalOpen && <EmployeeModal onClose={() => setIsInviteModalOpen(false)} onSave={(emp: Employee) => { setEmployees(p => [...p, emp]); setIsInviteModalOpen(false); }} />}
      {isEditModalOpen && <EmployeeModal initialData={isEditModalOpen} onClose={() => setIsEditModalOpen(null)} onSave={handleUpdateEmployee} />}
      {isBonusModalOpen && <BonusModal target={isBonusModalOpen} onClose={() => setIsBonusModalOpen(null)} onAdd={(rec: BonusLeaveRecord) => { setBonusRecords(p => [...p, rec]); setIsBonusModalOpen(null); }} />}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden animate-in zoom-in duration-200 max-h-[85vh] flex flex-col">
             <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
               <h3 className="font-bold text-sm">{isHistoryModalOpen.name}님의 상세 연차 기록</h3>
               <button onClick={() => setIsHistoryModalOpen(null)}><X size={18}/></button>
             </div>
             <div className="flex-1 overflow-y-auto p-4">
               <HistoryView employee={isHistoryModalOpen} requests={requests.filter(r => r.employeeId === isHistoryModalOpen.id)} bonusRecords={bonusRecords.filter(b => b.employeeId === isHistoryModalOpen.id)} isModal={true} />
             </div>
          </div>
        </div>
      )}
    </Router>
  );
}

// --- SUB COMPONENTS ---

const LoginScreen = ({ onLogin }: any) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-[24px] shadow-lg w-full max-w-xs text-center space-y-6 border border-slate-100">
        <div className="space-y-2">
          <div className="w-12 h-12 bg-blue-600 rounded-xl mx-auto flex items-center justify-center text-white text-2xl font-bold shadow-md">D</div>
          <h1 className="text-lg font-bold text-slate-900 text-nowrap">디센트 휴가시스템</h1>
          <p className="text-xs text-slate-400 font-medium tracking-tight">계정 정보를 입력하세요</p>
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onLogin(email, password); }}>
          <input type="email" required className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm outline-none focus:border-blue-500 transition-all" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" required className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm outline-none focus:border-blue-500 transition-all" placeholder="비밀번호" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition-all">로그인</button>
        </form>
      </div>
    </div>
  );
};

const Sidebar = ({ user, onLogout, isOpen, setIsOpen }: any) => {
  const loc = useLocation();
  const NavItem = ({ to, icon: Icon, label }: any) => (
    <Link to={to} onClick={() => setIsOpen(false)} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl transition-all ${loc.pathname === to ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
      <Icon size={16} /> <span className="text-xs font-bold">{label}</span>
    </Link>
  );
  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsOpen(false)} />}
      <div className={`fixed inset-y-0 left-0 z-50 w-56 bg-white border-r border-slate-200 flex flex-col p-4 transition-transform md:relative md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2 mb-8 px-2"><div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-base shrink-0">D</div><h1 className="text-sm font-bold tracking-tight text-slate-900">디센트 휴가시스템</h1></div>
        <nav className="flex-1 space-y-0.5">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="대시보드" />
          <NavItem to="/history" icon={History} label="연차 히스토리" />
          {user.role === Role.ADMIN && (
            <div className="pt-6 space-y-0.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase px-3 mb-2 tracking-widest">Admin</p>
              <NavItem to="/admin/employees" icon={Users} label="직원 관리" />
              <NavItem to="/admin/requests" icon={Calendar} label="연차 승인" />
            </div>
          )}
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-100">
          <div className="px-2 mb-3">
             <div className="flex items-center gap-1.5">
                <p className="text-xs font-bold text-slate-900 truncate">{user.name}</p>
                {user.role === Role.ADMIN && <ShieldCheck size={12} className="text-blue-500"/>}
             </div>
             <p className="text-[9px] text-slate-400 truncate">{user.email}</p>
          </div>
          <button onClick={onLogout} className="flex items-center gap-2 w-full px-3.5 py-2 text-red-500 text-[11px] font-bold hover:bg-red-50 rounded-lg transition-all"><LogOut size={14}/>로그아웃</button>
        </div>
      </div>
    </>
  );
};

const Dashboard = ({ employee, requests, bonusRecords, onAddRequest }: any) => {
  const empRequests = useMemo(() => requests.filter((r:any) => r.employeeId === employee.id), [requests, employee.id]);
  const balance = useMemo(() => getEmployeeLeaveBalance(employee.hireDate, empRequests, bonusRecords), [employee.hireDate, empRequests, bonusRecords]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [aiRes, setAiRes] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ 
    type: LeaveType.ANNUAL, startDate: format(new Date(), 'yyyy-MM-dd'), endDate: format(new Date(), 'yyyy-MM-dd'), 
    isAllDay: true, startTime: '09:00', endTime: '18:00', reason: '' 
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-400">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h2 className="text-xl font-bold text-slate-900">{employee.name}님, 환영합니다</h2><p className="text-xs text-slate-400 font-medium">입사일: {employee.hireDate}</p></div>
        <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-700 active:scale-95 transition-all shadow-sm"><PlusCircle size={16}/>연차 신청</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="법정 연차 발생" value={`${balance.accrued}일`} sub="근로기준법 기준" icon={Scale} />
        <StatCard label="보너스 연차 발생" value={`${balance.bonus}일`} sub="추가 지급분" icon={Award} color="text-amber-600" />
        <StatCard label="잔여 연차" value={`${balance.remainingAnnual}일`} color="text-blue-600" />
        <StatCard label="잔여 보너스" value={`${balance.remainingBonus}일`} color="text-indigo-600" />
      </div>
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-2 text-blue-600 font-bold text-xs"><MessageSquare size={14}/> AI 데이터 분석</div>
        {aiRes ? <div className="text-[11px] bg-slate-50 p-3 rounded-lg mb-3 leading-relaxed font-medium text-slate-700 border border-slate-100">{aiRes}</div> : <p className="text-slate-400 mb-3 text-[11px] font-medium">현재 연차 소진율과 잔여 일수를 AI로 분석합니다.</p>}
        <button disabled={loading} onClick={async () => { setLoading(true); setAiRes(await askGemini(`직원 ${employee.name}의 현재 잔여 연차는 ${balance.remainingAnnual}일입니다. 근속 현황을 고려해 짧고 명확하게 연차 사용 분석 및 제안을 해주세요.`) || ''); setLoading(false); }} className="bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg font-bold text-[10px] hover:bg-slate-100 transition-all">{loading ? '분석 중...' : '데이터 리포트 요청 →'}</button>
      </div>
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b flex justify-between items-center bg-slate-50/50 sticky top-0 z-10"><h3 className="font-bold text-sm">연차 신청</h3><button onClick={() => setIsModalOpen(false)}><X size={16}/></button></div>
            <div className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 ml-1">연차 종류</label>
                <select className="w-full border border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-500" value={form.type} onChange={e => setForm({...form, type: e.target.value as LeaveType})}>
                  <option value={LeaveType.ANNUAL}>일반 연차 (1.0일)</option>
                  <option value={LeaveType.MORNING_HALF}>오전 반차 (0.5일)</option>
                  <option value={LeaveType.AFTERNOON_HALF}>오후 반차 (0.5일)</option>
                  <option value={LeaveType.BONUS}>보너스 연차 (1.0일)</option>
                  <option value={LeaveType.BONUS_MORNING_HALF}>보너스 오전 반차 (0.5일)</option>
                  <option value={LeaveType.BONUS_AFTERNOON_HALF}>보너스 오후 반차 (0.5일)</option>
                  <option value={LeaveType.BIRTHDAY}>생일 반차 (0일 차감)</option>
                  <option value={LeaveType.OFFICIAL}>공결 (0일 차감)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 px-1">
                <input type="checkbox" id="all-day" checked={form.isAllDay} onChange={e => setForm({...form, isAllDay: e.target.checked})} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"/>
                <label htmlFor="all-day" className="text-xs font-bold text-slate-600 cursor-pointer">종일 체크</label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 ml-1">시작일</label><input type="date" className="w-full border border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})}/></div>
                <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 ml-1">종료일</label><input type="date" className="w-full border border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})}/></div>
              </div>
              {!form.isAllDay && (
                <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 ml-1">시작 시간</label><input type="time" className="w-full border border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})}/></div>
                  <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 ml-1">종료 시간</label><input type="time" className="w-full border border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})}/></div>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 ml-1">신청 사유</label>
                <textarea className="w-full border border-slate-200 p-3 rounded-lg h-20 text-xs font-medium bg-slate-50 outline-none focus:border-blue-500 resize-none" placeholder="신청 사유를 입력하세요." value={form.reason} onChange={e => setForm({...form, reason: e.target.value})}/>
              </div>
            </div>
            <div className="p-5 bg-slate-50 flex gap-2 sticky bottom-0">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-500 text-xs">취소</button>
              <button onClick={() => { onAddRequest(form); setIsModalOpen(false); }} className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-blue-700 active:scale-95 shadow-md transition-all">신청 접수</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, sub, icon: Icon, color = "text-slate-900" }: any) => (
  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center relative overflow-hidden group">
    <div className="flex justify-between items-start">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1 z-10">{label}</p>
      {Icon && <Icon className="text-slate-100 group-hover:text-blue-50 transition-colors absolute -right-2 -bottom-2" size={48} />}
    </div>
    <p className={`text-xl font-bold ${color} tracking-tight z-10`}>{value}</p>
    {sub && <p className="text-[9px] text-slate-300 mt-1 font-medium z-10">{sub}</p>}
  </div>
);

const HistoryView = ({ employee, requests, bonusRecords, isModal = false }: any) => {
  const unifiedHistory = useMemo(() => getUnifiedHistory(employee, requests, bonusRecords), [employee, requests, bonusRecords]);

  return (
    <div className={`space-y-4 ${!isModal ? 'animate-in fade-in duration-400' : ''}`}>
      {!isModal && <h2 className="text-xl font-bold text-slate-900">연차 통합 히스토리</h2>}
      <div className={`${!isModal ? 'bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto' : ''}`}>
        <table className="w-full text-left min-w-[600px]">
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            <tr>
              <th className="px-4 py-3">날짜</th>
              <th className="px-4 py-3">구분</th>
              <th className="px-4 py-3">변동</th>
              <th className="px-4 py-3">사유 및 상세</th>
              <th className="px-4 py-3 text-right">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {unifiedHistory.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3 text-[11px] font-medium text-slate-500">{item.date}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {item.type === 'EARNED' ? <TrendingUp size={12} className="text-green-500"/> : <TrendingDown size={12} className="text-red-400"/>}
                    <span className="font-bold text-slate-700 text-[11px]">{item.category}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-bold ${item.type === 'EARNED' ? 'text-green-600' : 'text-red-600'}`}>
                    {item.type === 'EARNED' ? `+${item.amount}` : `-${item.amount}`}일
                  </span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-[11px] font-bold text-slate-700">{item.reason}</p>
                  {item.detail && <p className="text-[10px] text-slate-400 mt-0.5">{item.detail}</p>}
                </td>
                <td className="px-4 py-3 text-right">
                  {item.status ? (
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${item.status === 'APPROVED' ? 'bg-green-50 text-green-600' : (item.status === 'REJECTED' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}`}>
                      {item.status}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-400">COMPLETE</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {unifiedHistory.length === 0 && <div className="p-16 text-center text-slate-300 font-bold text-xs">기록이 없습니다.</div>}
      </div>
    </div>
  );
};

const AdminRequestView = ({ requests, setRequests, employees }: any) => (
  <div className="space-y-4 animate-in fade-in duration-400">
    <h2 className="text-xl font-bold text-slate-900">승인 대기 요청</h2>
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
      <table className="w-full text-left min-w-[600px]">
        <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <tr><th className="px-4 py-3">직원</th><th className="px-4 py-3">유형/기간</th><th className="px-4 py-3 text-right">관리</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {requests.filter((r: any) => r.status === LeaveStatus.PENDING).map((req: any) => (
            <tr key={req.id} className="hover:bg-slate-50/50">
              <td className="px-4 py-4 font-bold text-sm text-slate-900">{employees.find((e: any) => e.id === req.employeeId)?.name}</td>
              <td className="px-4 py-4">
                <p className="font-bold text-blue-600 text-[10px]">{LEAVE_TYPE_LABELS[req.type as LeaveType]}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{req.startDate} ~ {req.endDate}</p>
                {!req.isAllDay && <p className="text-[9px] text-slate-300 mt-0.5">{req.startTime} ~ {req.endTime}</p>}
              </td>
              <td className="px-4 py-4 text-right space-x-1.5">
                <button onClick={() => setRequests((p: any) => p.map((r: any) => r.id === req.id ? { ...r, status: LeaveStatus.APPROVED } : r))} className="text-green-600 bg-green-50 p-1.5 rounded-lg hover:bg-green-600 hover:text-white transition-all"><CheckCircle size={14}/></button>
                <button onClick={() => setRequests((p: any) => p.map((r: any) => r.id === req.id ? { ...r, status: LeaveStatus.REJECTED } : r))} className="text-red-600 bg-red-50 p-1.5 rounded-lg hover:bg-red-600 hover:text-white transition-all"><XCircle size={14}/></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {requests.filter((r: any) => r.status === LeaveStatus.PENDING).length === 0 && <div className="p-16 text-center font-bold text-slate-300 text-xs">대기 중인 요청이 없습니다. ✨</div>}
    </div>
  </div>
);

const AdminStat = ({ label, value, color = "text-slate-900" }: any) => (
  <div className="bg-slate-50/80 px-1.5 py-1 rounded-md text-center flex flex-col justify-center min-w-[58px] border border-slate-100/50">
    <p className="text-[7.5px] font-bold text-slate-400 uppercase tracking-tighter mb-0.5 whitespace-nowrap">{label}</p>
    <p className={`text-[10.5px] font-bold ${color}`}>{value}일</p>
  </div>
);

const EmployeeModal = ({ onClose, onSave, initialData }: any) => {
  const [form, setForm] = useState({ 
    name: initialData?.name || '', 
    email: initialData?.email || '', 
    password: initialData?.password || 'password1!', 
    hireDate: initialData?.hireDate || format(new Date(), 'yyyy-MM-dd'), 
    role: initialData?.role || Role.USER 
  });

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xs rounded-2xl shadow-xl overflow-hidden animate-in zoom-in duration-200">
        <div className="px-4 py-3 border-b bg-slate-50/50 flex justify-between items-center"><h3 className="font-bold text-sm">{initialData ? '직원 정보 수정' : '직원 등록'}</h3><button onClick={onClose}><X size={14}/></button></div>
        <div className="p-4 space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 ml-1">기본 정보</label>
            <input className="w-full border border-slate-200 p-2 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-500" placeholder="이름" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            <input type="email" className="w-full border border-slate-200 p-2 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-500" placeholder="이메일" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 ml-1">입사 정보 및 역할</label>
            <input type="date" className="w-full border border-slate-200 p-2 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-500" value={form.hireDate} onChange={e => setForm({...form, hireDate: e.target.value})} />
            <div className="flex gap-2 p-1 bg-slate-50 rounded-lg">
               <button onClick={() => setForm({...form, role: Role.USER})} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${form.role === Role.USER ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><User size={12}/> 사용자</button>
               <button onClick={() => setForm({...form, role: Role.ADMIN})} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${form.role === Role.ADMIN ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><ShieldCheck size={12}/> 관리자</button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 ml-1">보안</label>
            <input className="w-full border border-blue-100 p-2 rounded-lg text-xs font-bold bg-blue-50/50 outline-none" placeholder="비밀번호" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
          </div>
        </div>
        <div className="px-4 py-3 bg-slate-50 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-500 text-xs">취소</button>
          <button onClick={() => onSave({ ...form, id: initialData?.id || Math.random().toString(36).substr(2, 9) })} className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-blue-700 shadow-sm transition-all">저장</button>
        </div>
      </div>
    </div>
  );
};

const BonusModal = ({ target, onClose, onAdd }: any) => {
  const [amt, setAmt] = useState('1.0');
  const [reason, setReason] = useState('성과 보상');
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xs rounded-2xl shadow-xl overflow-hidden animate-in zoom-in duration-200">
        <div className="p-6 text-center bg-amber-50/50 space-y-2"><Award className="mx-auto text-amber-500" size={28}/><h3 className="font-bold text-sm text-slate-900">{target.name}님 보너스</h3></div>
        <div className="p-4 space-y-3 text-center">
           <p className="text-[10px] font-bold text-slate-400">부여 일수</p>
           <input type="number" step="0.5" className="w-full border border-slate-200 p-3 rounded-xl font-bold text-center text-2xl bg-slate-50 outline-none" value={amt} onChange={e => setAmt(e.target.value)} />
           <textarea className="w-full border border-slate-200 p-2 rounded-lg text-[10px] font-medium bg-slate-50 h-16 outline-none focus:border-amber-400 resize-none" placeholder="사유" value={reason} onChange={e => setReason(e.target.value)}/>
        </div>
        <div className="px-4 py-3 bg-slate-50 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-500 text-xs">취소</button>
          <button onClick={() => onAdd({ id: Math.random().toString(36).substr(2, 9), employeeId: target.empId, amount: parseFloat(amt), reason, createdAt: new Date().toISOString() })} className="flex-1 py-2 bg-amber-500 text-white rounded-lg font-bold text-xs hover:bg-amber-600 transition-all shadow-sm">부여</button>
        </div>
      </div>
    </div>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) ReactDOM.createRoot(rootEl).render(<App />);
