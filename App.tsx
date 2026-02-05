
import React, { useState, useEffect, useMemo } from 'react';
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
  Bell, 
  LogOut, 
  User as UserIcon,
  CheckCircle,
  XCircle,
  PlusCircle,
  MessageSquare,
  History,
  Menu,
  X,
  ChevronRight,
  Info,
  Clock,
  UserPlus,
  Mail,
  CalendarDays,
  FileText,
  TrendingUp,
  Award
} from 'lucide-react';
import { 
  Role, 
  Employee, 
  LeaveRequest, 
  LeaveStatus, 
  LeaveType, 
  BonusLeaveRecord, 
  Notification 
} from './types';
import { getEmployeeLeaveBalance, calculateWorkdays } from './utils/dateUtils';
import { format, parseISO, differenceInCalendarDays, isValid, differenceInMonths, differenceInYears, addMonths, addYears } from 'date-fns';
import { askGemini } from './services/geminiService';

// --- INITIAL DATA ---
const INITIAL_EMPLOYEES: Employee[] = [
  { id: '1', name: '김관리', email: 'admin@company.com', role: Role.ADMIN, hireDate: '2020-01-01' },
  { id: '2', name: '이직원', email: 'user@company.com', role: Role.USER, hireDate: '2023-05-15' },
  { id: '3', name: '박신입', email: 'new@company.com', role: Role.USER, hireDate: '2024-02-10' },
];

const MOCK_REQUESTS: LeaveRequest[] = [
  { id: 'r1', employeeId: '2', type: LeaveType.ANNUAL, startDate: '2024-03-01', endDate: '2024-03-04', status: LeaveStatus.APPROVED, reason: '휴가입니다.', createdAt: '2024-02-20' },
  { id: 'r2', employeeId: '2', type: LeaveType.ANNUAL, startDate: '2024-05-20', endDate: '2024-05-20', status: LeaveStatus.PENDING, reason: '개인 사정', createdAt: '2024-05-10' },
];

// --- COMPONENTS ---

const Sidebar = ({ currentUser, onLogout, isOpen, setIsOpen }: { currentUser: Employee, onLogout: () => void, isOpen: boolean, setIsOpen: (val: boolean) => void }) => {
  const location = useLocation();
  const isAdmin = currentUser.role === Role.ADMIN;

  const NavItem = ({ to, icon: Icon, label }: { to: string, icon: any, label: string }) => {
    const isActive = location.pathname === to;
    return (
      <Link 
        to={to} 
        onClick={() => setIsOpen(false)} 
        className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${
          isActive ? 'bg-blue-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        <Icon size={20} />
        <span className="font-medium">{label}</span>
      </Link>
    );
  };

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r flex flex-col p-4 shadow-xl md:shadow-none 
        transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between mb-8 px-2">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center text-white font-bold">S</div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">SmartLeave</h1>
          </div>
          <button 
            onClick={() => setIsOpen(false)}
            className="md:hidden p-2 text-slate-400 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="대시보드" />
          <NavItem to="/history" icon={History} label="연차 히스토리" />
          {isAdmin && (
            <>
              <div className="mt-8 mb-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">관리자 메뉴</div>
              <NavItem to="/admin/employees" icon={Users} label="직원 관리" />
              <NavItem to="/admin/requests" icon={Calendar} label="연차 신청 관리" />
            </>
          )}
        </nav>

        <div className="mt-auto pt-4 border-t">
          <div className="flex items-center space-x-3 p-3 bg-slate-50 rounded-lg mb-4 overflow-hidden">
            <div className="w-10 h-10 min-w-[40px] bg-slate-200 rounded-full flex items-center justify-center text-slate-500">
              <UserIcon size={20} />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate text-slate-900">{currentUser.name}</p>
              <p className="text-xs text-slate-500 truncate">{currentUser.email}</p>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="flex items-center space-x-3 w-full p-3 text-red-500 hover:bg-red-50 transition-colors rounded-lg font-medium"
          >
            <LogOut size={20} />
            <span>로그아웃</span>
          </button>
        </div>
      </div>
    </>
  );
};

const Dashboard = ({ 
  employee, 
  requests, 
  bonusRecords, 
  onAddRequest 
}: { 
  employee: Employee, 
  requests: LeaveRequest[], 
  bonusRecords: BonusLeaveRecord[],
  onAddRequest: (req: Omit<LeaveRequest, 'id' | 'status' | 'createdAt'>) => void
}) => {
  const balance = useMemo(() => getEmployeeLeaveBalance(employee.hireDate, requests, bonusRecords), [employee.hireDate, requests, bonusRecords]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Leave Form State
  const [formData, setFormData] = useState({
    type: LeaveType.ANNUAL,
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    reason: ''
  });

  // 주말을 포함한 총 캘린더 일수
  const totalCalendarDays = useMemo(() => {
    const s = parseISO(formData.startDate);
    const e = parseISO(formData.endDate);
    if (!isValid(s) || !isValid(e)) return 0;
    const diff = differenceInCalendarDays(e, s) + 1;
    return diff > 0 ? diff : 0;
  }, [formData.startDate, formData.endDate]);

  // 주말을 제외한 실제 평일(근무일) 수
  const workdaysCount = useMemo(() => {
    const s = parseISO(formData.startDate);
    const e = parseISO(formData.endDate);
    if (!isValid(s) || !isValid(e)) return 0;
    return calculateWorkdays(s, e);
  }, [formData.startDate, formData.endDate]);

  const deduction = useMemo(() => {
    if (formData.type === LeaveType.BIRTHDAY || formData.type === LeaveType.OFFICIAL) return 0;
    if (formData.type === LeaveType.MORNING_HALF || formData.type === LeaveType.AFTERNOON_HALF) return workdaysCount * 0.5;
    return workdaysCount;
  }, [formData.type, workdaysCount]);

  const handleAiAsk = async () => {
    setIsAiLoading(true);
    const res = await askGemini(`제 입사일은 ${employee.hireDate}입니다. 현재 저의 연차 발생 원리와 남은 연차에 대해 요약해주세요.`);
    setAiResponse(res || '');
    setIsAiLoading(false);
  };

  const handleSubmitRequest = () => {
    if (totalCalendarDays <= 0) {
      alert("종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }
    if (formData.reason.trim() === "") {
      alert("신청 사유를 입력해주세요.");
      return;
    }

    onAddRequest({
      employeeId: employee.id,
      type: formData.type,
      startDate: formData.startDate,
      endDate: formData.endDate,
      reason: formData.reason
    });

    setIsModalOpen(false);
    setFormData({
      type: LeaveType.ANNUAL,
      startDate: format(new Date(), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
      reason: ''
    });
  };

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900">안녕하세요, {employee.name}님!</h2>
          <p className="text-sm md:text-base text-slate-500 font-medium">오늘도 즐겁고 활기찬 하루 되세요.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all shadow-lg hover:shadow-blue-200"
        >
          <PlusCircle size={20} />
          <span>연차 신청하기</span>
        </button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">총 발생 연차</p>
          <div className="flex items-baseline space-x-1">
            <span className="text-2xl md:text-3xl font-bold text-blue-600">{balance.accrued + balance.bonus}</span>
            <span className="text-slate-400 font-medium">일</span>
          </div>
          <p className="text-[10px] md:text-xs text-slate-400 mt-2 font-medium">일반 {balance.accrued} / 보너스 {balance.bonus}</p>
        </div>
        <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">사용 연차</p>
          <div className="flex items-baseline space-x-1">
            <span className="text-2xl md:text-3xl font-bold text-slate-800">{balance.usedAnnual + balance.usedBonus}</span>
            <span className="text-slate-400 font-medium">일</span>
          </div>
          <p className="text-[10px] md:text-xs text-slate-400 mt-2 font-medium">평일 차감 기준</p>
        </div>
        <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-blue-100 ring-2 ring-blue-50">
          <p className="text-sm font-medium text-blue-600 mb-1">잔여 연차</p>
          <div className="flex items-baseline space-x-1">
            <span className="text-2xl md:text-3xl font-bold text-blue-700">{balance.remainingAnnual + balance.remainingBonus}</span>
            <span className="text-blue-400 font-medium">일</span>
          </div>
          <p className="text-[10px] md:text-xs text-blue-400 mt-2 font-bold">사용 가능일 기준</p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-5 md:p-6 rounded-2xl border border-blue-100">
        <div className="flex items-center space-x-2 mb-4">
          <MessageSquare className="text-blue-600" size={20} />
          <h3 className="text-base md:text-lg font-bold text-blue-900">AI 인사 도우미</h3>
        </div>
        <div className="space-y-4">
          {aiResponse ? (
            <div className="bg-white/80 p-4 rounded-xl text-slate-700 text-sm leading-relaxed border border-white whitespace-pre-wrap shadow-sm">
              {aiResponse}
            </div>
          ) : (
            <p className="text-sm text-slate-600 font-medium">내 연차 정책이나 남은 연차에 대해 궁금한 점이 있나요?</p>
          )}
          <button 
            disabled={isAiLoading}
            onClick={handleAiAsk}
            className="text-sm font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 flex items-center"
          >
            {isAiLoading ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-2"></div>
                분석 중...
              </>
            ) : '나의 연차 상태 분석 요청하기 →'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
        <div className="p-4 border-b bg-slate-50/50">
          <h3 className="font-bold text-slate-800">최근 신청 내역</h3>
        </div>
        <div className="divide-y overflow-x-auto">
          {requests.length > 0 ? [...requests].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(req => {
            const workdays = calculateWorkdays(parseISO(req.startDate), parseISO(req.endDate));
            let displayDeduction = workdays;
            if (req.type === LeaveType.MORNING_HALF || req.type === LeaveType.AFTERNOON_HALF) displayDeduction = workdays * 0.5;
            else if (req.type === LeaveType.BIRTHDAY || req.type === LeaveType.OFFICIAL) displayDeduction = 0;

            return (
              <div key={req.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors min-w-[300px]">
                <div className="flex items-center space-x-4">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    req.status === LeaveStatus.APPROVED ? 'bg-green-500' : 
                    req.status === LeaveStatus.REJECTED ? 'bg-red-500' : 'bg-amber-500'
                  }`} />
                  <div className="overflow-hidden">
                    <p className="font-bold text-sm text-slate-800 truncate">{req.type} - {req.startDate} ~ {req.endDate} ({displayDeduction}일)</p>
                    <p className="text-xs text-slate-500 truncate font-medium">{req.reason}</p>
                  </div>
                </div>
                <span className={`text-[10px] md:text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ml-4 ${
                  req.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-700' : 
                  req.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {req.status === LeaveStatus.APPROVED ? '승인됨' : 
                   req.status === LeaveStatus.REJECTED ? '거절됨' : '대기중'}
                </span>
              </div>
            );
          }) : (
            <div className="p-8 text-center text-slate-400 font-medium italic">신청 내역이 없습니다.</div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="text-xl font-bold">연차 신청</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-lg transition-colors"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 text-amber-800 text-xs font-medium flex items-center gap-2">
                <Info size={14} />
                <span>반차는 평일 일수의 0.5일이 차감됩니다.</span>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">연차 종류</label>
                <select 
                  className="w-full border-slate-200 border p-2.5 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                  value={formData.type}
                  onChange={e => setFormData({...formData, type: e.target.value as LeaveType})}
                >
                  <option value={LeaveType.ANNUAL}>일반 연차 (1일)</option>
                  <option value={LeaveType.MORNING_HALF}>오전 반차 (0.5일)</option>
                  <option value={LeaveType.AFTERNOON_HALF}>오후 반차 (0.5일)</option>
                  <option value={LeaveType.BONUS}>보너스 연차 (1일)</option>
                  <option value={LeaveType.BIRTHDAY}>생일 반차 (0일)</option>
                  <option value={LeaveType.OFFICIAL}>공결 (0일)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">시작일</label>
                  <input 
                    type="date" 
                    className="w-full border-slate-200 border p-2.5 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" 
                    value={formData.startDate}
                    onChange={e => setFormData({...formData, startDate: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">종료일</label>
                  <input 
                    type="date" 
                    className="w-full border-slate-200 border p-2.5 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" 
                    value={formData.endDate}
                    onChange={e => setFormData({...formData, endDate: e.target.value})}
                  />
                </div>
              </div>

              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center justify-between shadow-inner">
                <div className="flex flex-col">
                  <div className="flex items-center space-x-2 text-blue-700 font-bold">
                    <Clock size={18} />
                    <span className="text-sm">실제 연차 차감</span>
                  </div>
                  <p className="text-[10px] text-blue-400 mt-0.5 font-bold">
                    총 {totalCalendarDays}일 중 평일 {workdaysCount}일 기준
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-blue-700">{deduction}</span>
                  <span className="text-sm font-bold text-blue-600 ml-1">일</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">사유</label>
                <textarea 
                  className="w-full border-slate-200 border p-3 rounded-xl h-24 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow resize-none" 
                  placeholder="연차 신청 사유를 입력하세요."
                  value={formData.reason}
                  onChange={e => setFormData({...formData, reason: e.target.value})}
                ></textarea>
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex space-x-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-white bg-white/50 transition-all active:scale-95"
              >
                취소
              </button>
              <button 
                onClick={handleSubmitRequest}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md shadow-blue-100 transition-all active:scale-95"
              >
                신청하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AdminEmployees = ({ 
  employees, 
  setEmployees,
  requests, 
  bonusRecords, 
  setBonusRecords 
}: { 
  employees: Employee[], 
  setEmployees: any,
  requests: LeaveRequest[], 
  bonusRecords: BonusLeaveRecord[], 
  setBonusRecords: any 
}) => {
  const [bonusTarget, setBonusTarget] = useState<Employee | null>(null);
  const [detailTarget, setDetailTarget] = useState<Employee | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [bonusValue, setBonusValue] = useState<string>("");
  const [bonusMemo, setBonusMemo] = useState<string>("");
  
  // New Employee Form State
  const [newEmp, setNewEmp] = useState({
    name: '',
    email: '',
    hireDate: format(new Date(), 'yyyy-MM-dd'),
    role: Role.USER
  });

  const handleAddBonus = () => {
    if (!bonusTarget || bonusValue === "" || isNaN(Number(bonusValue))) return;
    const newRecord: BonusLeaveRecord = {
      id: Math.random().toString(36).substr(2, 9),
      employeeId: bonusTarget.id,
      amount: Number(bonusValue),
      reason: bonusMemo.trim() || '관리자 수기 추가',
      createdAt: new Date().toISOString()
    };
    setBonusRecords((prev: BonusLeaveRecord[]) => [...prev, newRecord]);
    setBonusTarget(null);
    setBonusValue("");
    setBonusMemo("");
    alert(`${bonusTarget.name}님에게 보너스 연차 ${bonusValue}일이 추가되었습니다.`);
  };

  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmp.name || !newEmp.email || !newEmp.hireDate) {
      alert("모든 필드를 입력해주세요.");
      return;
    }
    
    const newEmployee: Employee = {
      id: Math.random().toString(36).substr(2, 9),
      name: newEmp.name,
      email: newEmp.email,
      hireDate: newEmp.hireDate,
      role: newEmp.role
    };
    
    setEmployees((prev: Employee[]) => [...prev, newEmployee]);
    setIsAddModalOpen(false);
    setNewEmp({
      name: '',
      email: '',
      hireDate: format(new Date(), 'yyyy-MM-dd'),
      role: Role.USER
    });
    alert(`${newEmployee.name} 직원이 등록되었습니다.`);
  };

  const getEmpRequests = (empId: string) => requests.filter(r => r.employeeId === empId);
  const getEmpBonus = (empId: string) => bonusRecords.filter(b => b.employeeId === empId);

  // 입사일 기준으로 가상 연차 발생 내역을 생성하는 헬퍼 함수
  const generateAccrualHistory = (emp: Employee) => {
    const history: any[] = [];
    const hireDate = parseISO(emp.hireDate);
    const today = new Date();
    
    const monthsDiff = differenceInMonths(today, hireDate);
    for (let i = 1; i <= Math.min(monthsDiff, 11); i++) {
      const accrualDate = addMonths(hireDate, i);
      if (accrualDate <= today) {
        history.push({
          id: `accrual-m-${i}-${emp.id}`,
          type: 'ACCRUAL',
          date: format(accrualDate, 'yyyy-MM-dd'),
          amount: 1,
          label: `${i}개월 만근 연차 발생`,
          createdAt: accrualDate.toISOString()
        });
      }
    }

    const yearsDiff = differenceInYears(today, hireDate);
    for (let i = 1; i <= yearsDiff; i++) {
      const anniversary = addYears(hireDate, i);
      if (anniversary <= today) {
        const additionalDays = i >= 2 ? Math.floor((i - 1) / 2) : 0;
        const amount = 15 + additionalDays;
        history.push({
          id: `accrual-y-${i}-${emp.id}`,
          type: 'ACCRUAL',
          date: format(anniversary, 'yyyy-MM-dd'),
          amount: amount,
          label: `${i}주년 정기 연차 발생 (가산 ${additionalDays}일 포함)`,
          createdAt: anniversary.toISOString()
        });
      }
    }
    return history;
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900">직원 연차 현황 관리</h2>
          <p className="text-xs text-slate-500 font-medium">전체 {employees.length}명의 직원이 등록되어 있습니다.</p>
        </div>
        <button 
          onClick={() => setIsAddModalOpen(true)}
          className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold flex items-center space-x-2 transition-all shadow-lg active:scale-95 w-full sm:w-auto justify-center"
        >
          <UserPlus size={18} />
          <span>직원 추가</span>
        </button>
      </div>
      
      <div className="grid grid-cols-1 gap-4 md:gap-6">
        {employees.map(emp => {
          const empBonus = getEmpBonus(emp.id);
          const balance = getEmployeeLeaveBalance(emp.hireDate, getEmpRequests(emp.id), empBonus);
          return (
            <div 
              key={emp.id} 
              onClick={() => setDetailTarget(emp)}
              className="bg-white p-5 md:p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group animate-in fade-in duration-300"
            >
              <div className="flex items-center space-x-4 md:space-x-6">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 text-lg md:text-xl font-bold flex-shrink-0 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                  {emp.name[0]}
                </div>
                <div className="overflow-hidden">
                  <h3 className="text-base md:text-lg font-bold truncate group-hover:text-blue-700 transition-colors text-slate-900">{emp.name}</h3>
                  <div className="flex items-center space-x-2 text-xs md:text-sm text-slate-500">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${emp.role === Role.ADMIN ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                      {emp.role === Role.ADMIN ? '관리자' : '일반'}
                    </span>
                    <span className="truncate">입사일: {emp.hireDate}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 md:space-x-8 text-center border-y md:border-none py-4 md:py-0 border-slate-50">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">발생</p>
                  <p className="text-sm md:text-xl font-bold text-slate-700">{balance.accrued + balance.bonus}일</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">사용</p>
                  <p className="text-sm md:text-xl font-bold text-slate-700">{balance.usedAnnual + balance.usedBonus}일</p>
                </div>
                <div>
                  <p className="text-[10px] text-blue-400 font-bold uppercase mb-1">잔여</p>
                  <p className="text-sm md:text-xl font-bold text-blue-600">{balance.remainingAnnual + balance.remainingBonus}일</p>
                </div>
              </div>

              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setBonusTarget(emp);
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm transition-colors w-full md:w-auto border border-slate-200"
              >
                보너스 부여
              </button>
            </div>
          );
        })}
      </div>

      {bonusTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-900">{bonusTarget.name} 보너스 연차 부여</h3>
            <p className="text-xs text-slate-500 font-medium">부여할 연차 일수와 사유를 입력해 주세요.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                  <Clock size={14} className="text-slate-400" />
                  <span>일수</span>
                </label>
                <input 
                  type="number" 
                  step="0.5"
                  placeholder="숫자 입력 (예: 1.5)"
                  value={bonusValue}
                  onChange={(e) => setBonusValue(e.target.value)}
                  autoFocus
                  className="w-full border-slate-200 border p-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-lg" 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                  <FileText size={14} className="text-slate-400" />
                  <span>부여 사유 (메모)</span>
                </label>
                <textarea 
                  placeholder="예: 프로젝트 완수 포상, 야근 대체 등"
                  value={bonusMemo}
                  onChange={(e) => setBonusMemo(e.target.value)}
                  className="w-full border-slate-200 border p-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm h-24 resize-none"
                />
              </div>
            </div>
            <div className="flex space-x-2 pt-4">
              <button 
                onClick={() => {
                  setBonusTarget(null);
                  setBonusValue("");
                  setBonusMemo("");
                }}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-600 bg-white hover:bg-slate-50 transition-all active:scale-95"
              >
                취소
              </button>
              <button 
                onClick={handleAddBonus}
                disabled={bonusValue === "" || isNaN(Number(bonusValue))}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50 hover:bg-blue-700 transition-all shadow-md active:scale-95"
              >
                부여하기
              </button>
            </div>
          </div>
        </div>
      )}

      {detailTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[110] p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl animate-in slide-in-from-bottom-8 duration-300 my-8">
            <div className="p-6 border-b flex items-center justify-between bg-slate-50/50 rounded-t-3xl">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
                  {detailTarget.name[0]}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{detailTarget.name} 상세 현황</h3>
                  <p className="text-xs text-slate-500 font-medium">{detailTarget.email} · 입사 {detailTarget.hireDate}</p>
                </div>
              </div>
              <button onClick={() => setDetailTarget(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-8">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: '일반 연차', val: getEmployeeLeaveBalance(detailTarget.hireDate, getEmpRequests(detailTarget.id), []).accrued, color: 'text-slate-600' },
                  { label: '보너스 연차', val: getEmpBonus(detailTarget.id).reduce((sum, b) => sum + b.amount, 0), color: 'text-indigo-600' },
                  { label: '사용(전체)', val: getEmployeeLeaveBalance(detailTarget.hireDate, getEmpRequests(detailTarget.id), getEmpBonus(detailTarget.id)).usedAnnual + getEmployeeLeaveBalance(detailTarget.hireDate, getEmpRequests(detailTarget.id), getEmpBonus(detailTarget.id)).usedBonus, color: 'text-red-600' },
                  { label: '잔여 연차', val: getEmployeeLeaveBalance(detailTarget.hireDate, getEmpRequests(detailTarget.id), getEmpBonus(detailTarget.id)).remainingAnnual + getEmployeeLeaveBalance(detailTarget.hireDate, getEmpRequests(detailTarget.id), getEmpBonus(detailTarget.id)).remainingBonus, color: 'text-blue-600 font-bold' },
                ].map((item, i) => (
                  <div key={i} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center shadow-inner">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">{item.label}</p>
                    <p className={`text-lg ${item.color}`}>{item.val}일</p>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-800 flex items-center space-x-2">
                    <History size={18} className="text-slate-400" />
                    <span>히스토리</span>
                  </h4>
                  <span className="text-[10px] bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full font-bold">전체 기록</span>
                </div>
                
                <div className="border border-slate-100 rounded-2xl overflow-hidden divide-y max-h-80 overflow-y-auto shadow-sm">
                  {(() => {
                    const combinedHistory = [
                      ...getEmpRequests(detailTarget.id).map(r => ({ ...r, hType: 'REQUEST' })),
                      ...getEmpBonus(detailTarget.id).map(b => ({ ...b, hType: 'BONUS' })),
                      ...generateAccrualHistory(detailTarget).map(a => ({ ...a, hType: 'ACCRUAL' }))
                    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

                    if (combinedHistory.length === 0) {
                      return <div className="p-12 text-center text-slate-400 italic text-sm font-medium">기록이 없습니다.</div>;
                    }

                    return combinedHistory.map(item => {
                      if (item.hType === 'REQUEST') {
                        const workdays = calculateWorkdays(parseISO(item.startDate), parseISO(item.endDate));
                        let deduction = workdays;
                        if (item.type === LeaveType.MORNING_HALF || item.type === LeaveType.AFTERNOON_HALF) deduction = workdays * 0.5;
                        else if (item.type === LeaveType.BIRTHDAY || item.type === LeaveType.OFFICIAL) deduction = 0;

                        return (
                          <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-700">{item.startDate} ~ {item.endDate} ({deduction}일 차감)</span>
                              <div className="flex items-center space-x-2 mt-1">
                                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{item.type}</span>
                                <span className="text-xs text-slate-500 truncate max-w-[200px] font-medium">{item.reason}</span>
                              </div>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                              item.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-700' : 
                              item.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {item.status === LeaveStatus.APPROVED ? '승인' : item.status === LeaveStatus.REJECTED ? '거절' : '대기'}
                            </span>
                          </div>
                        );
                      } else if (item.hType === 'BONUS') {
                        return (
                          <div key={item.id} className="p-4 flex items-center justify-between bg-indigo-50/20">
                            <div>
                              <p className="text-xs font-bold text-indigo-700">보너스 연차 부여 (+{item.amount}일)</p>
                              <p className="text-[10px] text-slate-400 font-bold">{item.createdAt.split('T')[0]} · {item.reason}</p>
                            </div>
                            <Award size={14} className="text-indigo-400" />
                          </div>
                        );
                      } else {
                        // ACCRUAL
                        return (
                          <div key={item.id} className="p-4 flex items-center justify-between bg-green-50/20">
                            <div>
                              <p className="text-xs font-bold text-green-700">기본 연차 발생 (+{item.amount}일)</p>
                              <p className="text-[10px] text-slate-400 font-bold">{item.date} · {item.label}</p>
                            </div>
                            <TrendingUp size={14} className="text-green-400" />
                          </div>
                        );
                      }
                    });
                  })()}
                </div>
              </div>
            </div>

            <div className="p-6 bg-slate-50 rounded-b-3xl text-center">
              <button 
                onClick={() => setDetailTarget(null)}
                className="w-full md:w-auto px-12 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-slate-600 hover:bg-slate-100 transition-all shadow-sm active:scale-95"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AdminRequests = ({ requests, setRequests, employees }: { requests: LeaveRequest[], setRequests: any, employees: Employee[] }) => {
  const handleAction = (id: string, status: LeaveStatus) => {
    setRequests((prev: LeaveRequest[]) => prev.map(r => r.id === id ? { ...r, status } : r));
    alert(`${status === LeaveStatus.APPROVED ? '승인' : '거절'} 처리가 완료되었습니다.`);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <h2 className="text-xl md:text-2xl font-bold text-slate-900">연차 신청 승인 관리</h2>
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[600px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-600 uppercase tracking-tight">직원명</th>
                <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-600 uppercase tracking-tight">종류</th>
                <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-600 uppercase tracking-tight">기간</th>
                <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-600 uppercase tracking-tight">상태</th>
                <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-600 text-right uppercase tracking-tight">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[...requests].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(req => {
                const emp = employees.find(e => e.id === req.employeeId);
                const workdays = calculateWorkdays(parseISO(req.startDate), parseISO(req.endDate));
                let deduction = workdays;
                if (req.type === LeaveType.MORNING_HALF || req.type === LeaveType.AFTERNOON_HALF) deduction = workdays * 0.5;
                else if (req.type === LeaveType.BIRTHDAY || req.type === LeaveType.OFFICIAL) deduction = 0;

                return (
                  <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-sm text-slate-800">{emp?.name || 'Unknown'}</div>
                      <div className="text-[10px] md:text-xs text-slate-400 font-medium">{emp?.email}</div>
                    </td>
                    <td className="px-6 py-4 text-xs md:text-sm text-slate-600 font-bold">{req.type}</td>
                    <td className="px-6 py-4 text-xs md:text-sm text-slate-600 font-medium">
                      {req.startDate} ~ {req.endDate} ({deduction}일)
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                        req.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-700' : 
                        req.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {req.status === LeaveStatus.PENDING && (
                        <div className="flex justify-end space-x-1">
                          <button 
                            onClick={() => handleAction(req.id, LeaveStatus.APPROVED)}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors border border-green-100"
                            title="승인"
                          >
                            <CheckCircle size={18} />
                          </button>
                          <button 
                            onClick={() => handleAction(req.id, LeaveStatus.REJECTED)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100"
                            title="거절"
                          >
                            <XCircle size={18} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [requests, setRequests] = useState<LeaveRequest[]>(MOCK_REQUESTS);
  const [bonusRecords, setBonusRecords] = useState<BonusLeaveRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogin = (role: Role) => {
    const user = employees.find(e => e.role === role);
    if (user) {
      setCurrentUser(user);
    } else {
      const firstWithRole = employees.find(e => e.role === role);
      if (firstWithRole) setCurrentUser(firstWithRole);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setSidebarOpen(false);
  };

  const handleAddRequest = (newReqData: Omit<LeaveRequest, 'id' | 'status' | 'createdAt'>) => {
    const newRequest: LeaveRequest = {
      ...newReqData,
      id: Math.random().toString(36).substr(2, 9),
      status: LeaveStatus.PENDING,
      createdAt: new Date().toISOString(),
    };
    setRequests(prev => [...prev, newRequest]);
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md space-y-8 border border-slate-200 animate-in fade-in zoom-in duration-300">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center text-white text-3xl font-bold mb-4 shadow-lg shadow-blue-200">
              S
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">SmartLeave</h1>
            <p className="text-slate-500 mt-2 font-medium">직원을 위한 스마트한 연차 관리 플랫폼</p>
          </div>
          
          <div className="space-y-4">
            <button 
              onClick={() => handleLogin(Role.ADMIN)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white p-4 rounded-2xl font-bold transition-all flex items-center justify-between active:scale-95"
            >
              <span>관리자 계정으로 로그인</span>
              <Users size={20} />
            </button>
            <button 
              onClick={() => handleLogin(Role.USER)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-2xl font-bold transition-all flex items-center justify-between shadow-lg shadow-blue-100 active:scale-95"
            >
              <span>직원 계정으로 로그인</span>
              <UserIcon size={20} />
            </button>
          </div>
          
          <p className="text-center text-xs text-slate-400 font-bold">
            SmartLeave v1.2.0 &copy; 2025
          </p>
        </div>
      </div>
    );
  }

  const userRequests = requests.filter(r => r.employeeId === currentUser.id);
  const userBonus = bonusRecords.filter(b => b.employeeId === currentUser.id);

  return (
    <Router>
      <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
        <Sidebar 
          currentUser={currentUser} 
          onLogout={handleLogout} 
          isOpen={sidebarOpen} 
          setIsOpen={setSidebarOpen} 
        />
        
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="bg-white border-b border-slate-200 px-4 py-3 md:hidden flex items-center justify-between z-30">
            <button 
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <Menu size={24} />
            </button>
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center text-white text-xs font-bold">S</div>
              <span className="font-bold text-sm text-slate-900">SmartLeave</span>
            </div>
            <div className="w-8" />
          </header>

          <main className="flex-1 overflow-y-auto scroll-smooth">
            <Routes>
              <Route path="/dashboard" element={
                <Dashboard 
                  employee={currentUser} 
                  requests={userRequests} 
                  bonusRecords={userBonus} 
                  onAddRequest={handleAddRequest}
                />
              } />
              <Route path="/history" element={
                <div className="p-4 md:p-8 max-w-7xl mx-auto">
                  <h2 className="text-xl md:text-2xl font-bold mb-6 text-slate-900">나의 연차 히스토리</h2>
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm animate-in fade-in duration-500">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left min-w-[500px]">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr>
                            <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-500 uppercase tracking-tight">일자</th>
                            <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-500 uppercase tracking-tight">종류</th>
                            <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-500 uppercase tracking-tight">상태</th>
                            <th className="px-6 py-4 text-xs md:text-sm font-bold text-slate-500 uppercase tracking-tight">사유</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {[...userRequests].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(req => {
                            const workdays = calculateWorkdays(parseISO(req.startDate), parseISO(req.endDate));
                            let deduction = workdays;
                            if (req.type === LeaveType.MORNING_HALF || req.type === LeaveType.AFTERNOON_HALF) deduction = workdays * 0.5;
                            else if (req.type === LeaveType.BIRTHDAY || req.type === LeaveType.OFFICIAL) deduction = 0;

                            return (
                              <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4 text-xs md:text-sm font-bold text-slate-900">
                                  {req.startDate} ~ {req.endDate} 
                                  <span className="ml-2 text-[10px] text-slate-400 font-medium">({deduction}일 차감)</span>
                                </td>
                                <td className="px-6 py-4 text-xs md:text-sm font-bold text-slate-700">{req.type}</td>
                                <td className="px-6 py-4 text-xs md:text-sm">
                                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                    req.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-700' : 
                                    req.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                  }`}>{req.status}</span>
                                </td>
                                <td className="px-6 py-4 text-xs md:text-sm text-slate-500 max-w-[200px] truncate font-medium">{req.reason}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              } />
              
              {currentUser.role === Role.ADMIN && (
                <>
                  <Route path="/admin/employees" element={
                    <AdminEmployees 
                      employees={employees} 
                      setEmployees={setEmployees}
                      requests={requests} 
                      bonusRecords={bonusRecords} 
                      setBonusRecords={setBonusRecords} 
                    />
                  } />
                  <Route path="/admin/requests" element={
                    <AdminRequests 
                      requests={requests} 
                      setRequests={setRequests} 
                      employees={employees} 
                    />
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
