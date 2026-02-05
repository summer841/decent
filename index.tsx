
import React, { useState, useMemo, useEffect } from 'react';
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
  Search,
  User,
  Edit2,
  TrendingUp,
  TrendingDown,
  FileText,
  Scale,
  Trash2,
  AlertTriangle,
  Settings,
  Bell,
  Share2
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
  isAfter
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

interface SystemSettings {
  slackWebhookUrl: string;
  useGoogleCalendar: boolean;
  googleCalendarId: string;
}

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

    if (isFree) deduction = 0; 
    else if (isHalfDay) deduction = workdays * 0.5; 
    else deduction = workdays;

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

const INITIAL_EMPLOYEES: Employee[] = [
  { id: 'admin-main', name: '최세영', email: 'summer@decentlaw.io', password: 'Injeolmi97', role: Role.ADMIN, hireDate: '2020-01-01' },
];

export default function App() {
  const [user, setUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('sl_user_v8');
    return saved ? JSON.parse(saved) : null;
  });
  const [employees, setEmployees] = useState<Employee[]>(() => {
    const saved = localStorage.getItem('sl_employees_v8');
    return saved ? JSON.parse(saved) : INITIAL_EMPLOYEES;
  });
  const [requests, setRequests] = useState<LeaveRequest[]>(() => {
    const saved = localStorage.getItem('sl_requests_v8');
    return saved ? JSON.parse(saved) : [];
  });
  const [bonusRecords, setBonusRecords] = useState<BonusLeaveRecord[]>(() => {
    const saved = localStorage.getItem('sl_bonus_v8');
    return saved ? JSON.parse(saved) : [];
  });
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(() => {
    const saved = localStorage.getItem('sl_settings_v8');
    return saved ? JSON.parse(saved) : { slackWebhookUrl: '', useGoogleCalendar: false, googleCalendarId: '' };
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<Employee | null>(null);
  const [isBonusModalOpen, setIsBonusModalOpen] = useState<{empId: string, name: string} | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<Employee | null>(null);

  useEffect(() => { localStorage.setItem('sl_user_v8', JSON.stringify(user)); }, [user]);
  useEffect(() => { localStorage.setItem('sl_employees_v8', JSON.stringify(employees)); }, [employees]);
  useEffect(() => { localStorage.setItem('sl_requests_v8', JSON.stringify(requests)); }, [requests]);
  useEffect(() => { localStorage.setItem('sl_bonus_v8', JSON.stringify(bonusRecords)); }, [bonusRecords]);
  useEffect(() => { localStorage.setItem('sl_settings_v8', JSON.stringify(systemSettings)); }, [systemSettings]);

  const handleLogin = (email: string, pass: string) => {
    const found = employees.find(e => e.email === email && e.password === pass);
    if (found) setUser(found);
    else alert('이메일 또는 비밀번호가 일치하지 않습니다.');
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('sl_user_v8');
  };

  const handleUpdateEmployee = (updatedEmp: Employee) => {
    setEmployees(prev => prev.map(emp => emp.id === updatedEmp.id ? updatedEmp : emp));
    if (user?.id === updatedEmp.id) setUser(updatedEmp);
    setIsEditModalOpen(null);
  };

  const handleDeleteEmployee = (id: string) => {
    if (id === user?.id) {
      alert('현재 로그인 중인 본인 계정은 삭제할 수 없습니다.');
      return;
    }
    setEmployees(prev => prev.filter(emp => emp.id !== id));
    setRequests(prev => prev.filter(req => req.employeeId !== id));
    setBonusRecords(prev => prev.filter(rec => rec.employeeId !== id));
    setIsEditModalOpen(null);
  };

  const handleApproveRequest = async (requestId: string) => {
    const request = requests.find(r => r.id === requestId);
    if (!request) return;

    setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: LeaveStatus.APPROVED } : r));
    
    const employee = employees.find(e => e.id === request.employeeId);
    if (!employee) return;

    // 슬랙 연동 알림
    if (systemSettings.slackWebhookUrl) {
      const message = `📢 *휴가 승인 알림*\n- 날짜: ${request.startDate}${request.startDate !== request.endDate ? ` ~ ${request.endDate}` : ''}\n- 이름: ${employee.name}\n- 휴가종류: ${LEAVE_TYPE_LABELS[request.type]}`;
      try {
        await fetch(systemSettings.slackWebhookUrl, {
          method: 'POST',
          body: JSON.stringify({ text: message }),
        });
        console.log('Slack notification sent');
      } catch (err) {
        console.error('Slack integration failed:', err);
      }
    }

    // 구글 캘린더 연동 (시뮬레이션)
    if (systemSettings.useGoogleCalendar) {
      console.log('Google Calendar Sync Triggered:', {
        summary: `${employee.name}, ${LEAVE_TYPE_LABELS[request.type]}`,
        start: request.startDate,
        end: request.endDate
      });
      // 실제 API 호출 로직은 OAuth 토큰과 함께 fetch(https://www.googleapis.com/calendar/v3/calendars/...) 형태가 됩니다.
    }
  };

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => emp.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [employees, searchTerm]);

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <Router>
      <div className="flex h-screen bg-[#F1F5F9] overflow-hidden text-slate-800 antialiased">
        <Sidebar user={user} onLogout={handleLogout} isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="bg-white border-b px-4 py-3 md:hidden flex justify-between items-center z-30">
            <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-slate-100 rounded-lg"><Menu size={18}/></button>
            <span className="font-bold text-blue-600">디센트 휴가시스템</span>
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
                              <input type="text" placeholder="검색..." className="pl-8 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                            </div>
                            <button onClick={() => setIsInviteModalOpen(true)} className="bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 hover:bg-blue-600 transition-all shadow-sm">
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
                                  <button onClick={() => setIsHistoryModalOpen(emp)} className="p-1.5 text-slate-300 hover:text-indigo-600"><FileText size={15}/></button>
                                  <button onClick={() => setIsEditModalOpen(emp)} className="p-1.5 text-slate-300 hover:text-blue-600"><Edit2 size={15}/></button>
                                  <button onClick={() => setIsBonusModalOpen({empId: emp.id, name: emp.name})} className="bg-slate-50 text-slate-500 px-2 py-1 rounded-md font-bold text-[9px] hover:bg-slate-900 hover:text-white transition-all border border-slate-100">보너스</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    } />
                    <Route path="/admin/requests" element={<AdminRequestView requests={requests} setRequests={setRequests} onApprove={handleApproveRequest} employees={employees} />} />
                    <Route path="/admin/settings" element={<SettingsView settings={systemSettings} onSave={setSystemSettings} />} />
                  </>
                )}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>

      {isInviteModalOpen && <EmployeeModal onClose={() => setIsInviteModalOpen(false)} onSave={(emp: Employee) => { setEmployees(p => [...p, emp]); setIsInviteModalOpen(false); }} />}
      {isEditModalOpen && <EmployeeModal initialData={isEditModalOpen} onClose={() => setIsEditModalOpen(null)} onSave={handleUpdateEmployee} onDelete={handleDeleteEmployee} />}
      {isBonusModalOpen && <BonusModal target={isBonusModalOpen} onClose={() => setIsBonusModalOpen(null)} onAdd={(rec: BonusLeaveRecord) => { setBonusRecords(p => [...p, rec]); setIsBonusModalOpen(null); }} />}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden max-h-[85vh] flex flex-col">
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-xs text-center space-y-6 border">
        <div className="space-y-2">
          <div className="w-12 h-12 bg-blue-600 rounded-xl mx-auto flex items-center justify-center text-white text-2xl font-bold">D</div>
          <h1 className="text-lg font-bold">디센트 휴가시스템</h1>
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onLogin(email, password); }}>
          <input type="email" required className="w-full bg-slate-50 border p-3 rounded-xl text-sm outline-none focus:border-blue-500" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" required className="w-full bg-slate-50 border p-3 rounded-xl text-sm outline-none focus:border-blue-500" placeholder="비밀번호" value={password} onChange={e => setPassword(e.target.value)} />
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
      <div className={`fixed inset-y-0 left-0 z-50 w-56 bg-white border-r flex flex-col p-4 transition-transform md:relative md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2 mb-8 px-2"><div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shrink-0">D</div><h1 className="text-sm font-bold tracking-tight">디센트 휴가시스템</h1></div>
        <nav className="flex-1 space-y-0.5">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="대시보드" />
          <NavItem to="/history" icon={History} label="연차 히스토리" />
          {user.role === Role.ADMIN && (
            <div className="pt-6 space-y-0.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase px-3 mb-2">Admin</p>
              <NavItem to="/admin/employees" icon={Users} label="직원 관리" />
              <NavItem to="/admin/requests" icon={Calendar} label="연차 승인" />
              <NavItem to="/admin/settings" icon={Settings} label="시스템 설정" />
            </div>
          )}
        </nav>
        <div className="mt-auto pt-4 border-t">
          <div className="px-2 mb-3">
             <div className="flex items-center gap-1.5"><p className="text-xs font-bold truncate">{user.name}</p>{user.role === Role.ADMIN && <ShieldCheck size={12} className="text-blue-500"/>}</div>
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
        <div><h2 className="text-xl font-bold">{employee.name}님, 환영합니다</h2><p className="text-xs text-slate-400">입사일: {employee.hireDate}</p></div>
        <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-700 shadow-sm"><PlusCircle size={16}/>연차 신청</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="법정 연차 발생" value={`${balance.accrued}일`} sub="근로기준법 기준" icon={Scale} />
        <StatCard label="보너스 연차 발생" value={`${balance.bonus}일`} sub="추가 지급분" icon={Award} color="text-amber-600" />
        <StatCard label="잔여 연차" value={`${balance.remainingAnnual}일`} color="text-blue-600" />
        <StatCard label="잔여 보너스" value={`${balance.remainingBonus}일`} color="text-indigo-600" />
      </div>
      <div className="bg-white p-5 rounded-xl border shadow-sm">
        <div className="flex items-center gap-2 mb-2 text-blue-600 font-bold text-xs"><MessageSquare size={14}/> AI 데이터 분석</div>
        {aiRes ? <div className="text-[11px] bg-slate-50 p-3 rounded-lg mb-3 leading-relaxed text-slate-700 border">{aiRes}</div> : <p className="text-slate-400 mb-3 text-[11px]">현재 연차 소진율과 잔여 일수를 AI로 분석합니다.</p>}
        <button disabled={loading} onClick={async () => { setLoading(true); setAiRes(await askGemini(`직원 ${employee.name}의 현재 잔여 연차는 ${balance.remainingAnnual}일입니다. 연차 사용 분석 및 제안을 해주세요.`) || ''); setLoading(false); }} className="bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg font-bold text-[10px] hover:bg-slate-100">{loading ? '분석 중...' : '분석 요청 →'}</button>
      </div>
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-in zoom-in duration-200">
            <div className="px-5 py-4 border-b flex justify-between items-center bg-slate-50"><h3 className="font-bold text-sm">연차 신청</h3><button onClick={() => setIsModalOpen(false)}><X size={16}/></button></div>
            <div className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400">연차 종류</label>
                <select className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none" value={form.type} onChange={e => setForm({...form, type: e.target.value as LeaveType})}>
                  <option value={LeaveType.ANNUAL}>일반 연차 (1.0일)</option>
                  <option value={LeaveType.MORNING_HALF}>오전 반차 (0.5일)</option>
                  <option value={LeaveType.AFTERNOON_HALF}>오후 반차 (0.5일)</option>
                  <option value={LeaveType.BONUS}>보너스 연차 (1.0일)</option>
                  <option value={LeaveType.BONUS_MORNING_HALF}>보너스 오전 반차 (0.5일)</option>
                  <option value={LeaveType.BONUS_AFTERNOON_HALF}>보너스 오후 반차 (0.5일)</option>
                  <option value={LeaveType.BIRTHDAY}>생일 반차 (0일)</option>
                  <option value={LeaveType.OFFICIAL}>공결 (0일)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="all-day" checked={form.isAllDay} onChange={e => setForm({...form, isAllDay: e.target.checked})} className="w-4 h-4 rounded text-blue-600"/>
                <label htmlFor="all-day" className="text-xs font-bold text-slate-600 cursor-pointer">종일 체크</label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">시작일</label><input type="date" className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})}/></div>
                <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">종료일</label><input type="date" className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})}/></div>
              </div>
              {!form.isAllDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">시작 시간</label><input type="time" className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})}/></div>
                  <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">종료 시간</label><input type="time" className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})}/></div>
                </div>
              )}
              <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">사유</label><textarea required className="w-full border p-2.5 rounded-lg text-xs font-medium bg-slate-50 h-20 resize-none" placeholder="휴가 사유..." value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} /></div>
              <button onClick={() => { onAddRequest(form); setIsModalOpen(false); }} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 shadow-sm">신청 완료</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, sub, icon: Icon, color = "text-slate-900" }: any) => (
  <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col justify-between">
    <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>{Icon && <Icon size={14} className="text-slate-300" />}</div>
    <div><div className={`text-xl font-bold ${color}`}>{value}</div>{sub && <p className="text-[9px] text-slate-400 font-medium mt-0.5">{sub}</p>}</div>
  </div>
);

const AdminStat = ({ label, value, color = "text-slate-500" }: any) => (
  <div className="px-2 py-1 rounded-md bg-slate-50 border flex flex-col items-center min-w-[50px]"><span className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">{label}</span><span className={`text-[11px] font-bold ${color}`}>{value}</span></div>
);

const HistoryView = ({ employee, requests, bonusRecords, isModal = false }: any) => {
  const history = useMemo(() => getUnifiedHistory(employee, requests, bonusRecords), [employee, requests, bonusRecords]);
  return (
    <div className={`space-y-4 ${!isModal ? 'animate-in fade-in duration-400' : ''}`}>
      {!isModal && <h2 className="text-xl font-bold">연차 히스토리</h2>}
      <div className="space-y-2">
        {history.length === 0 ? <div className="text-center py-12 text-slate-400 text-xs">기록이 없습니다.</div> : history.map(item => (
          <div key={item.id} className="bg-white p-3 rounded-xl border shadow-sm flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.type === 'EARNED' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>{item.type === 'EARNED' ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}</div>
              <div><div className="flex items-center gap-2"><span className="text-xs font-bold">{item.category}</span><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${item.type === 'EARNED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{item.type === 'EARNED' ? '+' : '-'}{item.amount}일</span></div><p className="text-[10px] text-slate-400">{item.reason}</p></div>
            </div>
            <div className="text-right text-[10px] font-bold">{item.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const AdminRequestView = ({ requests, onApprove, setRequests, employees }: any) => {
  const handleReject = (id: string) => setRequests((prev: any) => prev.map((r: any) => r.id === id ? { ...r, status: LeaveStatus.REJECTED } : r));
  const pendingRequests = requests.filter((r: any) => r.status === LeaveStatus.PENDING);
  return (
    <div className="space-y-6 animate-in fade-in duration-400">
      <h2 className="text-xl font-bold">연차 승인 관리</h2>
      <div className="space-y-3">
        {pendingRequests.length === 0 ? <div className="bg-white p-8 text-center rounded-xl border border-dashed text-slate-400 text-xs">대기 중인 요청이 없습니다.</div> : pendingRequests.map((req: any) => {
          const emp = employees.find((e: any) => e.id === req.employeeId);
          return (
            <div key={req.id} className="bg-white p-4 rounded-xl border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold">{emp?.name[0]}</div>
                <div><div className="flex items-center gap-2"><span className="text-xs font-bold">{emp?.name}</span><span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{LEAVE_TYPE_LABELS[req.type as LeaveType]}</span></div><p className="text-[10px] text-slate-400">{req.startDate} ~ {req.endDate} ({req.reason})</p></div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleReject(req.id)} className="px-4 py-2 bg-slate-50 text-slate-600 rounded-lg text-xs font-bold hover:bg-red-50 hover:text-red-600 transition-all">반려</button>
                <button onClick={() => onApprove(req.id)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all shadow-sm">승인</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SettingsView = ({ settings, onSave }: any) => {
  const [form, setForm] = useState(settings);
  return (
    <div className="space-y-6 animate-in fade-in duration-400">
      <div className="flex items-center gap-2"><h2 className="text-xl font-bold">시스템 설정</h2><Settings size={20} className="text-slate-400"/></div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-slate-900 font-bold"><Bell size={18} className="text-blue-500"/>슬랙 연동 설정</div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400">Incoming Webhook URL</label>
            <input 
              type="text" 
              className="w-full border p-2.5 rounded-lg text-xs bg-slate-50 outline-none focus:border-blue-500" 
              placeholder="https://hooks.slack.com/services/..." 
              value={form.slackWebhookUrl} 
              onChange={e => setForm({...form, slackWebhookUrl: e.target.value})} 
            />
            <p className="text-[9px] text-slate-400 leading-relaxed">휴가 승인 시 "날짜, 이름, 휴가종류" 알림이 해당 채널로 전송됩니다.</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-slate-900 font-bold"><Share2 size={18} className="text-emerald-500"/>구글 캘린더 연동</div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">자동 일정 추가 활성화</span>
            <button 
              onClick={() => setForm({...form, useGoogleCalendar: !form.useGoogleCalendar})}
              className={`w-10 h-5 rounded-full relative transition-all ${form.useGoogleCalendar ? 'bg-emerald-500' : 'bg-slate-200'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${form.useGoogleCalendar ? 'right-1' : 'left-1'}`}/>
            </button>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400">Calendar ID (Optional)</label>
            <input 
              disabled={!form.useGoogleCalendar}
              type="text" 
              className="w-full border p-2.5 rounded-lg text-xs bg-slate-50 outline-none focus:border-emerald-500 disabled:opacity-50" 
              placeholder="primary" 
              value={form.googleCalendarId} 
              onChange={e => setForm({...form, googleCalendarId: e.target.value})} 
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button 
          onClick={() => { onSave(form); alert('설정이 저장되었습니다.'); }} 
          className="bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-xs hover:bg-blue-600 transition-all shadow-md"
        >
          저장하기
        </button>
      </div>
    </div>
  );
};

const EmployeeModal = ({ initialData, onClose, onSave, onDelete }: any) => {
  const [form, setForm] = useState(initialData || { name: '', email: '', password: '', role: Role.USER, hireDate: format(new Date(), 'yyyy-MM-dd') });
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-in zoom-in duration-200">
        <div className="px-5 py-4 border-b flex justify-between items-center bg-slate-50"><h3 className="font-bold text-sm">직원 정보 {initialData ? '수정' : '등록'}</h3><button onClick={onClose}><X size={18}/></button></div>
        {isConfirmingDelete ? (
          <div className="p-6 text-center space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto"><AlertTriangle size={24}/></div>
            <div><h4 className="font-bold text-slate-900">정말 삭제하시겠습니까?</h4><p className="text-xs text-slate-400 mt-1">{form.name}님의 모든 연차 및 기록이 삭제됩니다.</p></div>
            <div className="flex gap-2">
              <button onClick={() => setIsConfirmingDelete(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs">취소</button>
              <button onClick={() => onDelete(initialData.id)} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-bold text-xs hover:bg-red-600">네, 삭제합니다</button>
            </div>
          </div>
        ) : (
          <form className="p-5 space-y-3" onSubmit={e => { e.preventDefault(); onSave(initialData ? { ...initialData, ...form } : { ...form, id: Math.random().toString(36).substr(2, 9) }); }}>
            <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">이름</label><input required className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-500" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">이메일</label><input required type="email" className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-500" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">비밀번호</label><input required className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-500" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">권한</label><select className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}><option value={Role.USER}>일반 직원</option><option value={Role.ADMIN}>관리자</option></select></div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">입사일</label><input type="date" className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50" value={form.hireDate} onChange={e => setForm({ ...form, hireDate: e.target.value })} /></div>
            </div>
            <div className="pt-4 flex flex-col gap-2">
              <button type="submit" className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 shadow-sm">저장하기</button>
              {initialData && (
                <button type="button" onClick={() => setIsConfirmingDelete(true)} className="w-full py-2.5 bg-white text-red-500 border border-red-100 rounded-xl font-bold text-xs hover:bg-red-50 flex items-center justify-center gap-1.5"><Trash2 size={14}/>직원 계정 삭제</button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

const BonusModal = ({ target, onClose, onAdd }: any) => {
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-in zoom-in duration-200">
        <div className="px-5 py-4 border-b flex justify-between items-center bg-slate-50"><h3 className="font-bold text-sm">보너스 지급 ({target.name})</h3><button onClick={onClose}><X size={18}/></button></div>
        <form className="p-5 space-y-4" onSubmit={e => { e.preventDefault(); onAdd({ id: Math.random().toString(36).substr(2, 9), employeeId: target.empId, amount, reason, createdAt: new Date().toISOString() }); }}>
          <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">지급 일수</label><input required type="number" step="0.5" min="0.5" className="w-full border p-2.5 rounded-lg text-xs font-bold bg-slate-50" value={amount} onChange={e => setAmount(Number(e.target.value))} /></div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400">지급 사유</label><textarea required className="w-full border p-2.5 rounded-lg text-xs font-medium bg-slate-50 h-24 resize-none" value={reason} onChange={e => setReason(e.target.value)} /></div>
          <button type="submit" className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-xs hover:bg-blue-600 shadow-sm">지급 완료</button>
        </form>
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
