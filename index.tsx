
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
  User as UserIcon,
  CheckCircle,
  XCircle,
  PlusCircle,
  MessageSquare,
  History,
  Menu,
  X,
  Clock,
  UserPlus,
  FileText,
  TrendingUp,
  Award,
  Info
} from 'lucide-react';
import { 
  differenceInMonths, 
  differenceInYears, 
  addYears, 
  isWithinInterval, 
  parseISO, 
  startOfDay,
  format,
  isWeekend,
  eachDayOfInterval,
  isValid
} from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// --- 1. TYPES (INTERNAL) ---
enum Role { ADMIN = 'ADMIN', USER = 'USER' }
enum LeaveStatus { PENDING = 'PENDING', APPROVED = 'APPROVED', REJECTED = 'REJECTED' }
enum LeaveType {
  ANNUAL = 'ANNUAL',
  BONUS = 'BONUS',
  MORNING_HALF = 'MORNING_HALF',
  AFTERNOON_HALF = 'AFTERNOON_HALF',
  BIRTHDAY = 'BIRTHDAY',
  OFFICIAL = 'OFFICIAL'
}

interface Employee { id: string; name: string; email: string; role: Role; hireDate: string; }
interface BonusLeaveRecord { id: string; employeeId: string; amount: number; reason: string; createdAt: string; }
interface LeaveRequest { id: string; employeeId: string; type: LeaveType; startDate: string; endDate: string; status: LeaveStatus; reason: string; createdAt: string; }
interface LeaveBalance { accrued: number; bonus: number; usedAnnual: number; usedBonus: number; remainingAnnual: number; remainingBonus: number; }

// --- 2. UTILS (INTERNAL) ---
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

  // 연차 발생 계산 (근로기준법 간소화 적용)
  const totalMonths = differenceInMonths(today, hireDate);
  let accrued = yearsSinceHire < 1 ? Math.min(totalMonths, 11) : Math.min(15 + Math.floor((yearsSinceHire - 1) / 2), 25);
  
  const bonus = bonusRecords.reduce((sum, r) => sum + r.amount, 0);

  let usedAnnual = 0, usedBonus = 0;
  requests.forEach(req => {
    if (req.status !== LeaveStatus.APPROVED) return;
    const start = parseISO(req.startDate);
    const workdays = calculateWorkdays(start, parseISO(req.endDate));
    let deduction = req.type.includes('HALF') ? workdays * 0.5 : (req.type === LeaveType.BIRTHDAY || req.type === LeaveType.OFFICIAL ? 0 : workdays);

    if (isWithinInterval(start, { start: startOfDay(finalCycleStart), end: startOfDay(cycleEnd) })) {
      req.type === LeaveType.BONUS ? usedBonus += deduction : usedAnnual += deduction;
    }
  });

  return {
    accrued, bonus, usedAnnual, usedBonus,
    remainingAnnual: Math.max(0, accrued - usedAnnual),
    remainingBonus: Math.max(0, bonus - usedBonus)
  };
};

const askGemini = async (prompt: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { systemInstruction: "당신은 인사 관리 AI입니다. 한국어로 친절하게 답하세요." }
    });
    return response.text;
  } catch { return "AI 분석 정보를 가져올 수 없습니다."; }
};

// --- 3. INITIAL DATA ---
const INITIAL_EMPLOYEES: Employee[] = [
  { id: '1', name: '김관리', email: 'admin@company.com', role: Role.ADMIN, hireDate: '2020-01-01' },
  { id: '2', name: '이직원', email: 'user@company.com', role: Role.USER, hireDate: '2023-05-15' },
  { id: '3', name: '박신입', email: 'new@company.com', role: Role.USER, hireDate: '2024-02-10' },
];

// --- 4. COMPONENTS ---
const Sidebar = ({ user, onLogout, isOpen, setIsOpen }: any) => {
  const loc = useLocation();
  const NavItem = ({ to, icon: Icon, label }: any) => (
    <Link to={to} onClick={() => setIsOpen(false)} className={`flex items-center gap-3 p-3 rounded-xl transition-all ${loc.pathname === to ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'text-slate-600 hover:bg-slate-100'}`}>
      <Icon size={20} /> <span className="font-bold">{label}</span>
    </Link>
  );

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsOpen(false)} />}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r flex flex-col p-6 transition-transform md:relative md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2 mb-10"><div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-xl">S</div><h1 className="text-xl font-black">SmartLeave</h1></div>
        <nav className="flex-1 space-y-2">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="대시보드" />
          <NavItem to="/history" icon={History} label="히스토리" />
          {user.role === Role.ADMIN && (
            <div className="pt-6 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 mb-2">Admin</p>
              <NavItem to="/admin/employees" icon={Users} label="직원 관리" />
              <NavItem to="/admin/requests" icon={Calendar} label="승인 관리" />
            </div>
          )}
        </nav>
        <button onClick={onLogout} className="mt-auto flex items-center gap-3 p-3 text-red-500 font-bold hover:bg-red-50 rounded-xl transition-colors"><LogOut size={20}/>로그아웃</button>
      </div>
    </>
  );
};

const Dashboard = ({ employee, requests, bonusRecords, onAddRequest }: any) => {
  const balance = useMemo(() => getEmployeeLeaveBalance(employee.hireDate, requests, bonusRecords), [employee.hireDate, requests, bonusRecords]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [aiRes, setAiRes] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ type: LeaveType.ANNUAL, startDate: format(new Date(), 'yyyy-MM-dd'), endDate: format(new Date(), 'yyyy-MM-dd'), reason: '' });

  return (
    <div className="p-6 md:p-10 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div><h2 className="text-3xl font-black text-slate-900 leading-tight">반가워요, {employee.name}님!</h2><p className="text-slate-500 font-bold">근속 기준: {employee.hireDate}</p></div>
        <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black flex items-center justify-center gap-2 shadow-xl shadow-blue-100 active:scale-95 transition-all"><PlusCircle size={20}/>연차 신청</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-[32px] border shadow-sm"><p className="text-xs font-black text-slate-400 uppercase mb-1">총 발생</p><p className="text-3xl font-black">{balance.accrued + balance.bonus}일</p><p className="text-[10px] text-slate-400 mt-2 font-bold">기본 {balance.accrued} / 보너스 {balance.bonus}</p></div>
        <div className="bg-white p-6 rounded-[32px] border shadow-sm"><p className="text-xs font-black text-slate-400 uppercase mb-1">사용 완료</p><p className="text-3xl font-black">{balance.usedAnnual + balance.usedBonus}일</p></div>
        <div className="bg-slate-900 p-6 rounded-[32px] text-white shadow-2xl"><p className="text-xs font-black text-slate-400 uppercase mb-1">잔여 연차</p><p className="text-4xl font-black">{balance.remainingAnnual + balance.remainingBonus}일</p><div className="flex gap-3 mt-3"><span className="text-[10px] bg-white/10 px-2 py-1 rounded-lg font-bold">일반 {balance.remainingAnnual}</span><span className="text-[10px] bg-white/10 px-2 py-1 rounded-lg font-bold">보너스 {balance.remainingBonus}</span></div></div>
      </div>

      <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-blue-600 font-bold"><MessageSquare size={18}/> AI 연차 도우미</div>
        {aiRes ? <div className="text-sm bg-blue-50/50 p-4 rounded-2xl mb-4 leading-relaxed whitespace-pre-wrap">{aiRes}</div> : <p className="text-sm text-slate-500 mb-4 font-medium">연차 규정이나 나의 상태에 대해 궁금한가요?</p>}
        <button disabled={loading} onClick={async () => { setLoading(true); setAiRes(await askGemini(`${employee.name}님의 입사일 ${employee.hireDate}, 잔여연차 ${balance.remainingAnnual}일 상황을 설명해줘.`) || ''); setLoading(false); }} className="text-blue-600 font-black text-sm hover:underline">{loading ? '분석 중...' : '나의 연차 상태 분석하기 →'}</button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[40px] shadow-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="p-8 border-b flex justify-between items-center"><h3 className="text-2xl font-black">연차 신청</h3><button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:bg-slate-100 p-1 rounded-xl"><X size={24}/></button></div>
            <div className="p-8 space-y-5">
              <div className="space-y-1"><label className="text-xs font-black text-slate-400 uppercase ml-1">연차 종류</label><select className="w-full border-2 p-3.5 rounded-2xl font-bold bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none border-transparent transition-all" value={form.type} onChange={e => setForm({...form, type: e.target.value as LeaveType})}><option value={LeaveType.ANNUAL}>일반 연차 (1일)</option><option value={LeaveType.MORNING_HALF}>오전 반차 (0.5일)</option><option value={LeaveType.AFTERNOON_HALF}>오후 반차 (0.5일)</option><option value={LeaveType.BONUS}>보너스 연차 (1일)</option></select></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-xs font-black text-slate-400 uppercase ml-1">시작일</label><input type="date" className="w-full border-2 p-3.5 rounded-2xl font-bold bg-slate-50 border-transparent transition-all" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})}/></div>
                <div className="space-y-1"><label className="text-xs font-black text-slate-400 uppercase ml-1">종료일</label><input type="date" className="w-full border-2 p-3.5 rounded-2xl font-bold bg-slate-50 border-transparent transition-all" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})}/></div>
              </div>
              <textarea className="w-full border-2 p-4 rounded-2xl h-28 resize-none bg-slate-50 border-transparent text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="사유를 입력해 주세요." value={form.reason} onChange={e => setForm({...form, reason: e.target.value})}/>
            </div>
            <div className="p-8 bg-slate-50 flex gap-4">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-4 bg-white border-2 rounded-2xl font-black text-slate-500 hover:bg-slate-100 transition-all active:scale-95">취소</button>
              <button onClick={() => { onAddRequest(form); setIsModalOpen(false); }} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all active:scale-95">신청 완료</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- 5. MAIN APP ---
function App() {
  const [user, setUser] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [bonusRecords, setBonusRecords] = useState<BonusLeaveRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-10 rounded-[48px] shadow-2xl w-full max-w-sm text-center space-y-8 animate-in zoom-in duration-500">
          <div className="space-y-2"><div className="w-20 h-20 bg-blue-600 rounded-[28px] mx-auto flex items-center justify-center text-white text-4xl font-black shadow-2xl shadow-blue-100">S</div><h1 className="text-4xl font-black text-slate-900 tracking-tight">SmartLeave</h1><p className="text-slate-400 font-bold">입사일 기준 자동 연차 관리 시스템</p></div>
          <div className="space-y-4 pt-4">
            <button onClick={() => setUser(employees[0])} className="w-full bg-slate-900 text-white p-5 rounded-[24px] font-black hover:bg-slate-800 transition-all active:scale-95 shadow-xl">관리자 로그인</button>
            <button onClick={() => setUser(employees[1])} className="w-full bg-blue-600 text-white p-5 rounded-[24px] font-black hover:bg-blue-700 transition-all active:scale-95 shadow-xl shadow-blue-100">직원 로그인</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-900">
        <Sidebar user={user} onLogout={() => setUser(null)} isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="bg-white/80 backdrop-blur-md border-b p-4 md:hidden flex justify-between items-center z-30 shadow-sm"><button onClick={() => setSidebarOpen(true)} className="p-2 bg-slate-50 rounded-xl"><Menu size={20}/></button><span className="font-black text-blue-600 text-xl tracking-tight">S.</span><div className="w-10"/></header>
          <main className="flex-1 overflow-y-auto bg-slate-50/50">
            <Routes>
              <Route path="/dashboard" element={<Dashboard employee={user} requests={requests.filter(r => r.employeeId === user.id)} bonusRecords={bonusRecords.filter(b => b.employeeId === user.id)} onAddRequest={(data: any) => setRequests(p => [...p, { ...data, id: Math.random().toString(36).substr(2, 9), status: LeaveStatus.PENDING, createdAt: new Date().toISOString() }])} />} />
              <Route path="/history" element={<div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500"><h2 className="text-3xl font-black">나의 연차 기록</h2><div className="bg-white rounded-[32px] border shadow-sm overflow-hidden"><table className="w-full text-left"><thead className="bg-slate-50 border-b"><tr><th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">날짜</th><th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">구분</th><th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">상태</th></tr></thead><tbody className="divide-y">{requests.filter(r => r.employeeId === user.id).map(r => (<tr key={r.id} className="hover:bg-slate-50/50 transition-colors"><td className="px-6 py-5 font-bold text-sm">{r.startDate} ~ {r.endDate}</td><td className="px-6 py-5 text-sm font-semibold">{r.type}</td><td className="px-6 py-5"><span className={`px-3 py-1 rounded-full text-[10px] font-black tracking-widest ${r.status === 'APPROVED' ? 'bg-green-100 text-green-700' : (r.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}`}>{r.status}</span></td></tr>))}</tbody></table>{requests.filter(r => r.employeeId === user.id).length === 0 && <div className="p-12 text-center text-slate-400 font-bold">기록이 없습니다.</div>}</div></div>} />
              {user.role === Role.ADMIN && (
                <>
                  <Route path="/admin/employees" element={
                    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
                      <div className="flex justify-between items-center"><h2 className="text-3xl font-black">직원 연차 관리</h2></div>
                      <div className="grid grid-cols-1 gap-4">
                        {employees.map(emp => {
                          const bal = getEmployeeLeaveBalance(emp.hireDate, requests.filter(r => r.employeeId === emp.id), bonusRecords.filter(b => b.employeeId === emp.id));
                          return (
                            <div key={emp.id} className="bg-white p-6 rounded-[32px] border shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6 hover:border-blue-300 transition-all group relative overflow-hidden">
                              <div className="flex items-center gap-5 min-w-[240px]">
                                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-black text-2xl group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">{emp.name[0]}</div>
                                <div><h3 className="text-xl font-black text-slate-900 group-hover:text-blue-700 transition-colors">{emp.name}</h3><p className="text-xs text-slate-400 font-bold">입사일: {emp.hireDate}</p></div>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1 items-center">
                                <div className="text-center p-3 bg-slate-50 rounded-2xl"><p className="text-[10px] font-black text-slate-400 uppercase mb-1">총 발생</p><p className="font-black text-lg">{bal.accrued + bal.bonus}일</p></div>
                                <div className="text-center p-3 bg-slate-50 rounded-2xl"><p className="text-[10px] font-black text-slate-400 uppercase mb-1">사용 합계</p><p className="font-black text-lg">{bal.usedAnnual + bal.usedBonus}일</p></div>
                                <div className="text-center p-3 bg-blue-50/80 rounded-2xl border border-blue-100/50"><p className="text-[10px] font-black text-blue-500 uppercase mb-1">잔여 일반</p><p className="font-black text-blue-700 text-xl">{bal.remainingAnnual}일</p></div>
                                <div className="text-center p-3 bg-indigo-50/80 rounded-2xl border border-indigo-100/50"><p className="text-[10px] font-black text-indigo-500 uppercase mb-1">잔여 보너스</p><p className="font-black text-indigo-700 text-xl">{bal.remainingBonus}일</p></div>
                              </div>
                              <button onClick={() => {
                                const amt = prompt(`${emp.name}님에게 부여할 보너스 연차 (일수)`);
                                if (amt && !isNaN(Number(amt))) {
                                  setBonusRecords(p => [...p, { id: Math.random().toString(36).substr(2, 9), employeeId: emp.id, amount: Number(amt), reason: '관리자 수기 부여', createdAt: new Date().toISOString() }]);
                                  alert('부여되었습니다.');
                                }
                              }} className="bg-slate-900 text-white px-6 py-4 rounded-2xl font-black text-sm hover:bg-blue-600 transition-all active:scale-95 whitespace-nowrap shadow-xl">보너스 부여</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  } />
                  <Route path="/admin/requests" element={
                    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
                      <h2 className="text-3xl font-black">승인 대기 목록</h2>
                      <div className="bg-white rounded-[32px] border shadow-sm overflow-hidden overflow-x-auto">
                        <table className="w-full text-left min-w-[700px]">
                          <thead className="bg-slate-50 border-b"><tr><th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">직원</th><th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">종류/기간</th><th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest text-right">승인 관리</th></tr></thead>
                          <tbody className="divide-y">{requests.filter(r => r.status === LeaveStatus.PENDING).map(req => (
                            <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-6 font-black text-lg">{employees.find(e => e.id === req.employeeId)?.name}</td>
                              <td className="px-6 py-6 font-bold text-slate-600">{req.type} <span className="text-sm font-medium text-slate-400">({req.startDate} ~ {req.endDate})</span></td>
                              <td className="px-6 py-6 text-right space-x-3">
                                <button onClick={() => setRequests(p => p.map(r => r.id === req.id ? { ...r, status: LeaveStatus.APPROVED } : r))} className="text-green-600 hover:bg-green-50 p-2.5 rounded-2xl border border-green-100 transition-colors inline-flex items-center gap-1 font-black"><CheckCircle size={20}/> 승인</button>
                                <button onClick={() => setRequests(p => p.map(r => r.id === req.id ? { ...r, status: LeaveStatus.REJECTED } : r))} className="text-red-600 hover:bg-red-50 p-2.5 rounded-2xl border border-red-100 transition-colors inline-flex items-center gap-1 font-black"><XCircle size={20}/> 거절</button>
                              </td>
                            </tr>
                          ))}</tbody>
                        </table>
                        {requests.filter(r => r.status === LeaveStatus.PENDING).length === 0 && <div className="p-16 text-center font-bold text-slate-400">처리할 신청 건이 없습니다.</div>}
                      </div>
                    </div>
                  } />
                </>
              )}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) ReactDOM.createRoot(rootEl).render(<App />);
