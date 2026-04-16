import React, { useState, useEffect, useMemo, Component, useRef } from 'react';
import { auth, db } from './firebase';
import * as XLSX from 'xlsx';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  getDocs,
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  where, 
  updateDoc,
  orderBy,
  addDoc,
  deleteDoc,
  writeBatch,
  limit
} from 'firebase/firestore';
import { 
  Users, 
  Calendar, 
  LogOut, 
  Shield, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Plus,
  UserCircle,
  UserPlus,
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  History,
  Edit2,
  Trash2,
  AlertTriangle,
  Database,
  Award,
  RefreshCw,
  Scale,
  Search,
  FileText,
  X,
  Share2,
  Settings,
  Bell,
  Upload,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  format, 
  parseISO, 
  differenceInYears, 
  differenceInMonths, 
  addYears, 
  addMonths, 
  addDays,
  isWithinInterval, 
  startOfDay, 
  eachDayOfInterval, 
  isWeekend, 
  isAfter,
  isValid
} from 'date-fns';
import { 
  Employee, 
  LeaveRequest, 
  UserRole, 
  LeaveType, 
  LeaveStatus, 
  LeaveBalance,
  BonusLeaveRecord,
  CarriedOverRecord,
  SystemSettings
} from './types';

console.log('App.tsx: File loaded');

// --- Constants & Labels ---

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

// --- Utils ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null, fatal: boolean = false) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error(`Firestore ${fatal ? 'Fatal' : 'Non-Fatal'} Error: `, JSON.stringify(errInfo));
  if (fatal) {
    throw new Error(JSON.stringify(errInfo));
  }
};

const safeParseISO = (dateStr: any): Date => {
  if (typeof dateStr !== 'string' || !dateStr) return new Date(NaN);
  
  // Try standard ISO first
  let d = parseISO(dateStr);
  if (isValid(d)) return d;

  // Try common Korean formats like yy-m-d or yyyy-m-d
  const parts = dateStr.split(/[-./]/);
  if (parts.length === 3) {
    let year = parseInt(parts[0]);
    let month = parseInt(parts[1]) - 1;
    let day = parseInt(parts[2]);
    
    if (year < 100) year += 2000; // Assume 20xx for yy
    d = new Date(year, month, day);
    if (isValid(d)) return d;
  }

  return new Date(NaN);
};

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
  bonusRecords: BonusLeaveRecord[],
  carriedOverRecords: CarriedOverRecord[],
  adjustment: number = 0
): LeaveBalance => {
  const today = new Date();
  const emptyBalance: LeaveBalance = { accrued: 0, carriedOver: 0, bonus: 0, usedAnnual: 0, usedBonus: 0, remainingAnnual: 0, remainingBonus: 0, totalRemaining: 0 };
  
  if (!hireDateStr) return emptyBalance;
  const hireDate = safeParseISO(hireDateStr);
  if (!isValid(hireDate)) return emptyBalance;
  
  const yearsSinceHire = differenceInYears(today, hireDate);
  const cycleStart = addYears(hireDate, yearsSinceHire);
  const finalCycleStart = cycleStart > today ? addYears(hireDate, yearsSinceHire - 1) : cycleStart;
  const cycleEnd = addYears(finalCycleStart, 1);
  const totalMonths = differenceInMonths(today, hireDate);
  
  let accrued = yearsSinceHire < 1 ? Math.min(totalMonths, 11) : Math.min(15 + Math.floor((yearsSinceHire - 1) / 2), 25);
  accrued += adjustment; // Apply manual adjustment
  const carriedOver = carriedOverRecords.reduce((sum, r) => sum + r.amount, 0);
  const bonus = bonusRecords.reduce((sum, r) => sum + r.amount, 0);
  
  let usedAnnual = 0, usedBonus = 0;
  requests.forEach(req => {
    if (req.status !== LeaveStatus.APPROVED && req.status !== LeaveStatus.PENDING) return;
    const start = safeParseISO(req.startDate);
    const end = safeParseISO(req.endDate);
    const workdays = calculateWorkdays(start, end);
    let deduction = 0;
    const isHalfDay = [LeaveType.MORNING_HALF, LeaveType.AFTERNOON_HALF, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF, LeaveType.BIRTHDAY].includes(req.type);
    const isFree = [LeaveType.OFFICIAL, LeaveType.BIRTHDAY].includes(req.type);
    
    if (isFree) deduction = 0; 
    else if (isHalfDay) deduction = workdays * 0.5; 
    else deduction = workdays;
    
    // Deduct if it's in the current cycle or future
    if (isWithinInterval(start, { start: startOfDay(finalCycleStart), end: startOfDay(cycleEnd) }) || isAfter(start, cycleEnd)) {
      const isBonusSource = [LeaveType.BONUS, LeaveType.BONUS_MORNING_HALF, LeaveType.BONUS_AFTERNOON_HALF].includes(req.type);
      isBonusSource ? usedBonus += deduction : usedAnnual += deduction;
    }
  });
  
  const remainingAnnual = Number((accrued + carriedOver - usedAnnual).toFixed(1));
  const remainingBonus = Number((bonus - usedBonus).toFixed(1));
  
  return { 
    accrued, carriedOver, bonus, usedAnnual, usedBonus, 
    remainingAnnual, 
    remainingBonus,
    totalRemaining: Number((remainingAnnual + remainingBonus).toFixed(1))
  };
};

// --- Components ---

const LoadingScreen = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-slate-600 font-medium">시스템을 불러오는 중...</p>
    </div>
  </div>
);

const LoginScreen = ({ isLoggingIn, setIsLoggingIn }: { isLoggingIn: boolean, setIsLoggingIn: (v: boolean) => void }) => {
  const handleLogin = async () => {
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setIsLoggingIn(false); // Reset login state on success
    } catch (error) {
      console.error('Login Error:', error);
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-xl shadow-indigo-100 p-8 text-center border border-indigo-50"
      >
        <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-200">
          <Calendar className="text-white w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">디센트 휴가시스템</h1>
        <p className="text-slate-500 mb-8">스마트한 연차 관리의 시작</p>
        
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          className={`w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-200 hover:border-indigo-600 hover:bg-indigo-50 text-slate-700 font-semibold py-4 px-6 rounded-2xl transition-all duration-200 group ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isLoggingIn ? (
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          ) : (
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
          )}
          {isLoggingIn ? '로그인 중...' : '구글 계정으로 시작하기'}
        </button>
      </motion.div>
    </div>
  );
};

// --- Main App ---

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "알 수 없는 오류가 발생했습니다.";
      let detailedError = "";
      try {
        const errorMsg = this.state.error?.message || String(this.state.error);
        detailedError = errorMsg;
        const parsed = JSON.parse(errorMsg);
        if (parsed.error && (parsed.error.includes('insufficient permissions') || parsed.error.includes('permission-denied'))) {
          errorMessage = "데이터베이스 접근 권한이 부족합니다. 관리자에게 문의하세요.";
        } else if (parsed.error) {
          errorMessage = parsed.error;
        }
      } catch {
        errorMessage = this.state.error?.message || String(this.state.error) || errorMessage;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-4">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto" />
            <h2 className="text-2xl font-bold text-slate-900">오류 발생</h2>
            <p className="text-slate-600">{errorMessage}</p>
            {detailedError && detailedError !== errorMessage && (
              <details className="text-left bg-slate-50 p-3 rounded-lg text-xs font-mono text-slate-500 overflow-auto max-h-40">
                <summary className="cursor-pointer mb-1">상세 오류 정보</summary>
                {detailedError}
              </details>
            )}
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
            >
              페이지 새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'admin' | 'requests' | 'history' | 'settings'>('dashboard');
  const [allUsers, setAllUsers] = useState<Employee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [bonusRecords, setBonusRecords] = useState<BonusLeaveRecord[]>([]);
  const [carriedRecords, setCarriedRecords] = useState<CarriedOverRecord[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) return;
      
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const tokens = event.data.tokens;
        if (tokens) {
          try {
            await setDoc(doc(db, 'settings', 'google_calendar_tokens'), tokens);
            console.log('Google tokens saved to Firestore');
          } catch (e) {
            console.error('Failed to save tokens:', e);
          }
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  
  // Modals
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null);
  const [isBonusModalOpen, setIsBonusModalOpen] = useState<Employee | null>(null);
  const [isCarriedModalOpen, setIsCarriedModalOpen] = useState<Employee | null>(null);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState<Employee | null>(null);
  const [isManageHistoryModalOpen, setIsManageHistoryModalOpen] = useState<Employee | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string, message: string, onConfirm: () => void } | null>(null);
  const [alertConfig, setAlertConfig] = useState<{ title: string, message: string } | null>(null);
  const [isAddEmployeeModalOpen, setIsAddEmployeeModalOpen] = useState(false);

  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    console.log('Auth useEffect started');
    // Safety timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.warn('Auth state listener timed out after 30s');
        setLoading(false);
        if (!user) {
          setAuthError('시스템을 불러오는 시간이 너무 오래 걸립니다. 네트워크 연결을 확인하거나 다시 시도해 주세요. (Timeout)');
        }
      }
    }, 30000);

    let unsubscribe: () => void;
    try {
      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        console.log('onAuthStateChanged fired:', firebaseUser ? `User: ${firebaseUser.email}` : 'No user');
        try {
          setAuthError(null);
          if (firebaseUser) {
            // 토큰이 준비되기 전에 Firestore 접근하면 permission-denied 발생 → 강제 갱신
            try {
              await firebaseUser.getIdToken(true);
            } catch (tokenError: any) {
              console.warn('Token refresh warning:', tokenError.message);
            }

            setUser(firebaseUser);
            setIsLoggingIn(false);
            console.log('User set, fetching employee profile...');
            
            const metaRef = doc(db, 'employees_meta', firebaseUser.uid);
            let employeeId: string | null = null;
            
            try {
              const metaSnap = await getDoc(metaRef);
              if (metaSnap.exists()) {
                employeeId = metaSnap.data().employeeId;
                console.log('Found employeeId from meta:', employeeId);
              } else {
                console.log('No meta found, searching by email...');
                const q = query(collection(db, 'employees'), where('email', '==', firebaseUser.email), limit(1));
                const querySnap = await getDocs(q);
                
                if (!querySnap.empty) {
                  const empDoc = querySnap.docs[0];
                  employeeId = empDoc.id;
                  console.log('Linked existing employee by email:', employeeId);
                  
                  // Link UID and create meta
                  await updateDoc(doc(db, 'employees', employeeId), { uid: firebaseUser.uid });
                  await setDoc(metaRef, { employeeId, role: empDoc.data().role });
                } else {
                  console.log('Fresh user, creating new employee record...');
                  // First admin or new user
                  employeeId = `EMP_${firebaseUser.uid.substring(0, 8)}`;
                  const newEmployee: Employee = {
                    employeeId,
                    uid: firebaseUser.uid,
                    email: firebaseUser.email || '',
                    displayName: firebaseUser.displayName || '',
                    photoURL: firebaseUser.photoURL || null,
                    role: firebaseUser.email === 'summer@decentlaw.io' ? 'admin' : 'user',
                    joinedAt: new Date().toISOString(),
                    hireDate: format(new Date(), 'yyyy-MM-dd'),
                    status: 'active'
                  };
                  await setDoc(doc(db, 'employees', employeeId), newEmployee);
                  await setDoc(metaRef, { employeeId, role: newEmployee.role });
                }
              }

              if (employeeId) {
                const empSnap = await getDoc(doc(db, 'employees', employeeId));
                if (empSnap.exists()) {
                  const empData = empSnap.data() as Employee;
                  setProfile(empData);
                  console.log('Employee profile loaded:', employeeId);
                } else {
                  throw new Error('Employee record not found after mapping');
                }
              }
              setLoading(false);
              clearTimeout(timeoutId);
            } catch (e: any) {
              console.error('Employee profile fetch failed:', e);
              setAuthError(`직원 정보 조회 오류: ${e.message}`);
              setLoading(false);
              clearTimeout(timeoutId);
            }
          } else {
            console.log('No user detected, showing login screen');
            setUser(null);
            setProfile(null);
            setLoading(false);
            setIsLoggingIn(false);
            clearTimeout(timeoutId);
          }
        } catch (error: any) {
          console.error('Inner Auth State Change Error:', error);
          setAuthError(`인증 처리 중 오류가 발생했습니다: ${error.message}`);
          setLoading(false);
          setIsLoggingIn(false);
          clearTimeout(timeoutId);
        }
      });
    } catch (error: any) {
      console.error('Outer Auth State Change Error:', error);
      setAuthError(`인증 시스템 초기화 중 오류가 발생했습니다: ${error.message}`);
      setLoading(false);
      clearTimeout(timeoutId);
      return;
    }

    return () => {
      if (unsubscribe) unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  // Real-time data
  useEffect(() => {
    if (!profile) return;

    // Settings
    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (snap) => {
      if (snap.exists()) {
        setSettings(snap.data() as SystemSettings);
      } else {
        const defaultSettings: SystemSettings = {
          slackWebhookUrl: '',
          useGoogleCalendar: false,
          googleCalendarId: '',
        };
        // Only try to create if admin, otherwise just use defaults
        if (profile.role === 'admin') {
          setDoc(doc(db, 'settings', 'global'), defaultSettings).catch(e => {
            console.warn('Failed to initialize settings:', e);
          });
        }
        setSettings(defaultSettings);
      }
    }, (e) => {
      console.warn('Settings snapshot error:', e);
      // Non-fatal error for settings
      if (!settings) {
        setSettings({
          slackWebhookUrl: '',
          useGoogleCalendar: false,
          googleCalendarId: '',
        });
      }
    });

    // Employees (Admin only)
    if (profile.role === 'admin') {
      const unsubEmployees = onSnapshot(query(collection(db, 'employees'), orderBy('joinedAt', 'desc')), (snap) => {
        setAllUsers(snap.docs.map(d => d.data() as Employee));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'employees', false));
      
      const unsubBonus = onSnapshot(collection(db, 'bonusRecords'), (snap) => {
        setBonusRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as BonusLeaveRecord)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'bonusRecords', false));

      const unsubCarried = onSnapshot(collection(db, 'carriedRecords'), (snap) => {
        setCarriedRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as CarriedOverRecord)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'carriedRecords', false));

      const unsubRequests = onSnapshot(query(collection(db, 'leaveRequests'), orderBy('createdAt', 'desc')), (snap) => {
        setLeaveRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'leaveRequests', false));

      return () => {
        unsubSettings();
        unsubEmployees();
        unsubBonus();
        unsubCarried();
        unsubRequests();
      };
    } else {
      // Regular employee data
      const unsubBonus = onSnapshot(query(collection(db, 'bonusRecords'), where('employeeId', '==', profile.employeeId)), (snap) => {
        setBonusRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as BonusLeaveRecord)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'bonusRecords', false));

      const unsubCarried = onSnapshot(query(collection(db, 'carriedRecords'), where('employeeId', '==', profile.employeeId)), (snap) => {
        setCarriedRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as CarriedOverRecord)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'carriedRecords', false));

      const unsubRequests = onSnapshot(query(collection(db, 'leaveRequests'), where('employeeId', '==', profile.employeeId), orderBy('createdAt', 'desc')), (snap) => {
        setLeaveRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'leaveRequests', false));

      return () => {
        unsubSettings();
        unsubBonus();
        unsubCarried();
        unsubRequests();
      };
    }
  }, [profile]);

  const myBalance = useMemo(() => {
    if (!profile) return null;
    return getEmployeeLeaveBalance(
      profile.hireDate, 
      leaveRequests.filter(r => r.employeeId === profile.employeeId),
      bonusRecords.filter(r => r.employeeId === profile.employeeId),
      carriedRecords.filter(r => r.employeeId === profile.employeeId),
      profile.adjustment || 0
    );
  }, [profile, leaveRequests, bonusRecords, carriedRecords]);

  const handleToggleRole = async (targetUser: Employee) => {
    if (!profile || profile.role !== 'admin') return;
    const newRole: UserRole = targetUser.role === 'admin' ? 'user' : 'admin';
    try {
      await updateDoc(doc(db, 'employees', targetUser.employeeId), { role: newRole });
      // Also update meta for immediate effect on next login
      if (targetUser.uid) {
        await updateDoc(doc(db, 'employees_meta', targetUser.uid), { role: newRole });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `employees/${targetUser.employeeId}`);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      window.open(url, 'google_auth_popup', 'width=600,height=700');
    } catch (e) {
      console.error('Failed to get auth URL:', e);
    }
  };

  const handleBackup = () => {
    const data = {
      employees: allUsers,
      leaveRequests,
      bonusRecords,
      carriedRecords,
      settings,
      backupDate: new Date().toISOString(),
      version: '1.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decent_leave_backup_${format(new Date(), 'yyyyMMdd')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleProcessRequest = async (requestId: string, status: LeaveStatus) => {
    if (!profile || profile.role !== 'admin') return;
    try {
      await updateDoc(doc(db, 'leaveRequests', requestId), {
        status,
        processedBy: profile.employeeId,
        processedAt: new Date().toISOString()
      });

      // Google Calendar Sync
      if (status === LeaveStatus.APPROVED && settings?.useGoogleCalendar) {
        const req = leaveRequests.find(r => r.id === requestId);
        const emp = allUsers.find(u => u.employeeId === req?.employeeId);
        if (req && emp) {
          try {
            // Fetch tokens from Firestore
            const tokenSnap = await getDoc(doc(db, 'settings', 'google_calendar_tokens'));
            if (tokenSnap.exists()) {
              const tokens = tokenSnap.data();
              await fetch('/api/calendar/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  summary: `${emp.displayName} 휴가 (${LEAVE_TYPE_LABELS[req.type]})`,
                  description: req.reason,
                  start: req.startDate,
                  end: format(addDays(parseISO(req.endDate), 1), 'yyyy-MM-dd'),
                  calendarId: settings.googleCalendarId,
                  tokens
                })
              });
            }
          } catch (err) {
            console.error('Google Calendar sync failed:', err);
          }
        }
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `leaveRequests/${requestId}`);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    try {
      await updateDoc(doc(db, 'leaveRequests', requestId), {
        status: LeaveStatus.CANCELLED
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `leaveRequests/${requestId}`);
    }
  };

  const handleDeleteRecord = async (collName: 'bonusRecords' | 'carriedRecords', id: string) => {
    try {
      await deleteDoc(doc(db, collName, id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `${collName}/${id}`);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setProfile(null);
    } catch (error) {
      console.error('Logout Error:', error);
    }
  };

  if (loading) return <LoadingScreen />;

  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle size={32} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">오류 발생</h2>
          <p className="text-slate-600 mb-8">{authError}</p>
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
            >
              다시 시도
            </button>
            <button
              onClick={handleLogout}
              className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <LoginScreen 
        isLoggingIn={isLoggingIn} 
        setIsLoggingIn={setIsLoggingIn}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-white border-r border-slate-200 p-6 flex flex-col gap-8">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100">
            <Calendar className="text-white w-6 h-6" />
          </div>
          <span className="font-bold text-xl tracking-tight">디센트 휴가</span>
        </div>

        <nav className="flex-1 flex flex-col gap-2">
          <SidebarItem icon={<LayoutDashboard size={20} />} label="대시보드" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={<Clock size={20} />} label="내 휴가 현황" active={activeTab === 'requests'} onClick={() => setActiveTab('requests')} />
          <SidebarItem icon={<History size={20} />} label="변동 내역" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
          {profile.role === 'admin' && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 mb-2">관리자 메뉴</p>
              <SidebarItem icon={<Shield size={20} />} label="직원 관리" active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} />
              <SidebarItem icon={<Database size={20} />} label="시스템 설정" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
            </div>
          )}
        </nav>

        <div className="mt-auto pt-6 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-6 px-2">
            <img src={profile.photoURL || ''} className="w-10 h-10 rounded-full bg-slate-200" alt="" />
            <div className="flex-1 overflow-hidden">
              <p className="font-semibold text-sm truncate">{profile.displayName}</p>
              <p className="text-xs text-slate-500 truncate">{profile.role === 'admin' ? '관리자' : '직원'}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors font-medium">
            <LogOut size={20} /> 로그아웃
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-5xl mx-auto">
              <header className="mb-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-bold text-slate-900 mb-2">안녕하세요, {profile.displayName}님! 👋</h2>
                  <p className="text-slate-500">오늘의 휴가 현황을 확인하세요.</p>
                </div>
                <button 
                  onClick={() => { setEditingRequest(null); setIsRequestModalOpen(true); }}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100"
                >
                  <Plus size={20} /> 휴가 신청하기
                </button>
              </header>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                <StatCard label="법정 연차" value={`${myBalance?.accrued}일`} icon={Scale} color="bg-white" />
                <StatCard label="이월 연차" value={`${myBalance?.carriedOver}일`} icon={RefreshCw} color="bg-white" textColor="text-indigo-600" />
                <StatCard label="보너스" value={`${myBalance?.bonus}일`} icon={Award} color="bg-white" textColor="text-amber-600" />
                <StatCard 
                  label="잔여 연차" 
                  value={`${myBalance?.totalRemaining}일`} 
                  icon={Calendar}
                  color="bg-indigo-600 border-indigo-500 shadow-lg shadow-indigo-200" 
                  textColor="text-white" 
                  labelColor="text-indigo-100"
                  iconColor="text-indigo-300"
                  isBig 
                />
              </div>

              {profile.role === 'admin' && (
                <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold">대기 중인 승인 요청</h3>
                    <span className="px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-xs font-bold border border-amber-100">
                      {leaveRequests.filter(r => r.status === LeaveStatus.PENDING).length}건
                    </span>
                  </div>
                  <div className="space-y-4">
                    {leaveRequests.filter(r => r.status === LeaveStatus.PENDING).length === 0 ? (
                      <p className="text-slate-400 text-center py-10">대기 중인 신청이 없습니다.</p>
                    ) : (
                      leaveRequests.filter(r => r.status === LeaveStatus.PENDING).map(req => {
                        const requester = allUsers.find(u => u.employeeId === req.employeeId);
                        return (
                          <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100 gap-4">
                            <div className="flex items-center gap-4">
                              <img src={requester?.photoURL || ''} className="w-10 h-10 rounded-full bg-slate-200" alt="" />
                              <div>
                                <p className="font-bold text-slate-900">{requester?.displayName || '알 수 없는 사용자'} - {LEAVE_TYPE_LABELS[req.type]}</p>
                                <p className="text-xs text-slate-500">{req.startDate} ~ {req.endDate} ({req.reason})</p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => handleProcessRequest(req.id, LeaveStatus.APPROVED)} className="flex-1 sm:flex-none px-6 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-colors">승인</button>
                              <button onClick={() => handleProcessRequest(req.id, LeaveStatus.REJECTED)} className="flex-1 sm:flex-none px-6 py-2.5 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition-colors">거절</button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              )}
            </motion.div>
          )}

          {activeTab === 'admin' && profile.role === 'admin' && (
            <motion.div key="admin" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-6xl mx-auto">
              <header className="mb-10 flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold text-slate-900 mb-2">임직원 관리</h2>
                  <p className="text-slate-500">직원의 권한 및 연차 정보를 관리합니다.</p>
                </div>
                <button 
                  onClick={() => setIsAddEmployeeModalOpen(true)}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                >
                  <UserPlus size={18} /> 직원 추가
                </button>
              </header>

              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">직원</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">입사일</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">잔여 연차</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allUsers.map(u => {
                        const bal = getEmployeeLeaveBalance(
                          u.hireDate, 
                          leaveRequests.filter(r => r.employeeId === u.employeeId),
                          bonusRecords.filter(r => r.employeeId === u.employeeId),
                          carriedRecords.filter(r => r.employeeId === u.employeeId)
                        );
                        return (
                          <tr key={u.employeeId} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <img src={u.photoURL || ''} className="w-8 h-8 rounded-full bg-slate-200" alt="" />
                                <div>
                                  <p className="font-bold text-sm flex items-center gap-2">
                                    {u.displayName}
                                    {!u.uid && <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md font-bold">가입 대기</span>}
                                  </p>
                                  <p className="text-[10px] text-slate-400">{u.email} ({u.employeeId})</p>
                                </div>
                                {u.role === 'admin' && <Shield size={14} className="text-indigo-600" />}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-600">{u.hireDate}</td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-4">
                                <div className="text-center">
                                  <p className="text-[10px] font-bold text-slate-400">법정</p>
                                  <p className="text-sm font-bold text-slate-600">{bal.accrued}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-[10px] font-bold text-slate-400">이월</p>
                                  <p className="text-sm font-bold text-indigo-600">{bal.carriedOver}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-[10px] font-bold text-slate-400">보너스</p>
                                  <p className="text-sm font-bold text-amber-600">{bal.bonus}</p>
                                </div>
                                <div className="text-center bg-indigo-50 px-2 py-1 rounded-lg">
                                  <p className="text-[10px] font-bold text-indigo-400">잔여</p>
                                  <p className="text-sm font-bold text-indigo-700">{bal.totalRemaining}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setIsManageHistoryModalOpen(u)} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg" title="휴가 내역 관리"><Calendar size={18}/></button>
                                <button onClick={() => setIsCarriedModalOpen(u)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="이월 관리"><RefreshCw size={18}/></button>
                                <button onClick={() => setIsBonusModalOpen(u)} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title="보너스 관리"><Award size={18}/></button>
                                <button onClick={() => setIsEditUserModalOpen(u)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg" title="정보 수정"><Edit2 size={18}/></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'requests' && (
            <motion.div key="requests" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-5xl mx-auto">
              <header className="mb-10">
                <h2 className="text-3xl font-bold text-slate-900 mb-2">내 휴가 신청 내역</h2>
                <p className="text-slate-500">신청한 휴가의 승인 상태를 확인하세요.</p>
              </header>

              <div className="grid grid-cols-1 gap-4">
                {leaveRequests.filter(r => r.employeeId === profile.employeeId).length === 0 ? (
                  <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center">
                    <Calendar className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-400">신청 내역이 없습니다.</p>
                  </div>
                ) : (
                  leaveRequests.filter(r => r.employeeId === profile.employeeId).map(req => (
                    <div key={req.id} className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-6">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                          req.status === LeaveStatus.APPROVED ? 'bg-emerald-100 text-emerald-600' :
                          req.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                        }`}>
                          {req.status === LeaveStatus.APPROVED ? <CheckCircle2 /> : req.status === LeaveStatus.REJECTED ? <XCircle /> : <Clock />}
                        </div>
                        <div>
                          <p className="font-bold text-lg">{LEAVE_TYPE_LABELS[req.type]}</p>
                          <p className="text-slate-500 text-sm">{req.startDate} ~ {req.endDate} ({req.reason})</p>
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end gap-2">
                        <span className={`px-4 py-1.5 rounded-full text-sm font-bold ${
                          req.status === LeaveStatus.APPROVED ? 'bg-emerald-50 text-emerald-700' :
                          req.status === LeaveStatus.REJECTED ? 'bg-red-50 text-red-700' : 
                          req.status === LeaveStatus.CANCELLED ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {STATUS_LABELS[req.status]}
                        </span>
                        {(req.status === LeaveStatus.PENDING || req.status === LeaveStatus.APPROVED) && (
                          <button 
                            onClick={() => handleCancelRequest(req.id)}
                            className="text-xs font-bold text-red-500 hover:text-red-700 underline"
                          >
                            신청 취소
                          </button>
                        )}
                        <p className="text-xs text-slate-400 mt-1">신청일: {isValid(safeParseISO(req.createdAt)) ? format(safeParseISO(req.createdAt), 'yyyy-MM-dd') : ''}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div key="history" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-5xl mx-auto">
              <header className="mb-10">
                <h2 className="text-3xl font-bold text-slate-900 mb-2">연차 변동 내역</h2>
                <p className="text-slate-500">발생 및 사용된 모든 연차 기록입니다.</p>
              </header>

              <div className="space-y-4">
                {/* Simplified History View */}
                {[...leaveRequests.filter(r => r.employeeId === profile.employeeId && r.status === LeaveStatus.APPROVED), 
                  ...bonusRecords.filter(r => r.employeeId === profile.employeeId), 
                  ...carriedRecords.filter(r => r.employeeId === profile.employeeId)]
                  .sort((a, b) => {
                    const dateA = safeParseISO('startDate' in a ? a.startDate : a.createdAt);
                    const dateB = safeParseISO('startDate' in b ? b.startDate : b.createdAt);
                    return isAfter(dateB, dateA) ? 1 : -1;
                  })
                  .map((item: any) => {
                    const isRequest = 'type' in item;
                    const isBonus = 'amount' in item && !isRequest;
                    return (
                      <div key={item.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div className="flex items-center gap-5">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${!isRequest ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                            {!isRequest ? <TrendingUp size={22}/> : <TrendingDown size={22}/>}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">{isRequest ? LEAVE_TYPE_LABELS[item.type as LeaveType] : (isBonus ? '보너스 연차' : '이월 연차')}</p>
                            <p className="text-xs text-slate-500">{item.reason}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${!isRequest ? 'text-emerald-600' : 'text-blue-600'}`}>
                            {!isRequest ? `+${item.amount}` : `-${calculateWorkdays(safeParseISO(item.startDate), safeParseISO(item.endDate)) * ([LeaveType.ANNUAL, LeaveType.BONUS].includes(item.type) ? 1 : ([LeaveType.OFFICIAL, LeaveType.BIRTHDAY].includes(item.type) ? 0 : 0.5))}`}일
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {isRequest 
                              ? `${item.startDate}${item.startDate !== item.endDate ? ` ~ ${item.endDate}` : ''}` 
                              : (isValid(safeParseISO(item.createdAt)) ? format(safeParseISO(item.createdAt), 'yyyy-MM-dd') : '')}
                          </p>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            </motion.div>
          )}
          {activeTab === 'settings' && profile.role === 'admin' && (
            <motion.div key="settings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-4xl mx-auto">
              <header className="mb-10">
                <h2 className="text-3xl font-bold text-slate-900 mb-2">시스템 설정</h2>
                <p className="text-slate-500">애플리케이션의 전역 설정을 관리합니다.</p>
              </header>

              <div className="space-y-6">
                <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <FileText className="text-indigo-600" /> 슬랙 연동 설정
                  </h3>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase">Slack Webhook URL</label>
                      <input 
                        type="text" 
                        className="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-mono text-sm"
                        value={settings?.slackWebhookUrl || ''}
                        onChange={e => setSettings(s => s ? {...s, slackWebhookUrl: e.target.value} : null)}
                        placeholder="https://hooks.slack.com/services/..."
                      />
                    </div>
                    <button 
                      onClick={async () => {
                        try {
                          if (settings) await setDoc(doc(db, 'settings', 'global'), settings);
                        } catch (e) {
                          handleFirestoreError(e, OperationType.WRITE, 'settings/global');
                        }
                        console.log('설정이 저장되었습니다.');
                      }}
                      className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
                    >
                      저장하기
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Calendar className="text-indigo-600" /> 구글 캘린더 연동
                  </h3>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                      <div>
                        <p className="font-bold text-sm">구글 계정 연결</p>
                        <p className="text-xs text-slate-500">캘린더 권한을 획득하기 위해 구글 계정을 연결합니다.</p>
                      </div>
                      <button 
                        onClick={handleConnectGoogle}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-xs hover:bg-slate-50 transition-all flex items-center gap-2"
                      >
                        <Share2 size={14} className="text-emerald-500" /> 계정 연결하기
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                      <div>
                        <p className="font-bold text-sm">구글 캘린더 사용</p>
                        <p className="text-xs text-slate-500">승인된 휴가를 구글 캘린더에 자동으로 등록합니다.</p>
                      </div>
                      <button 
                        onClick={() => setSettings(s => s ? {...s, useGoogleCalendar: !s.useGoogleCalendar} : null)}
                        className={`w-14 h-7 rounded-full relative transition-all ${settings?.useGoogleCalendar ? 'bg-indigo-600' : 'bg-slate-300'}`}
                      >
                        <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${settings?.useGoogleCalendar ? 'right-1' : 'left-1'}`} />
                      </button>
                    </div>
                    {settings?.useGoogleCalendar && (
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-400 uppercase">Calendar ID</label>
                        <input 
                          type="text" 
                          className="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-mono text-sm"
                          value={settings?.googleCalendarId || ''}
                          onChange={e => setSettings(s => s ? {...s, googleCalendarId: e.target.value} : null)}
                          placeholder="primary or calendar_id@group.calendar.google.com"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Database className="text-indigo-600" /> 데이터 관리 및 백업
                  </h3>
                  <div className="space-y-4">
                    <p className="text-sm text-slate-500">
                      현재 서버에 저장된 모든 데이터를 JSON 파일로 다운로드하여 보관할 수 있습니다.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button 
                        onClick={handleBackup}
                        className="flex items-center gap-2 px-6 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all"
                      >
                        <TrendingDown size={18} /> 전체 데이터 내보내기 (.json)
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                      ※ Firebase 서버에 실시간으로 저장되고 있으나, 별도의 오프라인 보관이 필요한 경우 사용하세요.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isRequestModalOpen && (
          <LeaveRequestModal 
            onClose={() => setIsRequestModalOpen(false)} 
            onSubmit={async (data) => {
              try {
                await addDoc(collection(db, 'leaveRequests'), {
                  ...data,
                  employeeId: profile.employeeId,
                  employeeEmail: profile.email,
                  employeeName: profile.displayName,
                  status: LeaveStatus.PENDING,
                  createdAt: new Date().toISOString()
                });
                setIsRequestModalOpen(false);
              } catch (e: any) {
                handleFirestoreError(e, OperationType.CREATE, 'leaveRequests');
                let msg = '휴가 신청 중 오류가 발생했습니다.';
                try {
                  const parsed = JSON.parse(e.message);
                  if (parsed.error && parsed.error.includes('insufficient permissions')) {
                    msg = '권한이 부족합니다. (보안 규칙 확인 필요)';
                  }
                } catch {
                  msg = e.message || msg;
                }
                setAlertConfig({ title: '오류', message: msg });
              }
            }}
          />
        )}
        {isBonusModalOpen && (
          <RecordModal 
            title="보너스 연차"
            user={isBonusModalOpen}
            records={bonusRecords.filter(r => r.employeeId === isBonusModalOpen.employeeId)}
            onClose={() => setIsBonusModalOpen(null)}
            onSubmit={async (amount, reason) => {
              try {
                await addDoc(collection(db, 'bonusRecords'), {
                  employeeId: isBonusModalOpen.employeeId,
                  employeeEmail: isBonusModalOpen.email,
                  amount,
                  reason,
                  createdAt: new Date().toISOString()
                });
              } catch (e) {
                handleFirestoreError(e, OperationType.CREATE, 'bonusRecords');
              }
              setIsBonusModalOpen(null);
            }}
            onDelete={(id) => handleDeleteRecord('bonusRecords', id)}
          />
        )}
        {isCarriedModalOpen && (
          <RecordModal 
            title="이월 연차"
            user={isCarriedModalOpen}
            records={carriedRecords.filter(r => r.employeeId === isCarriedModalOpen.employeeId)}
            onClose={() => setIsCarriedModalOpen(null)}
            onSubmit={async (amount, reason) => {
              try {
                await addDoc(collection(db, 'carriedRecords'), {
                  employeeId: isCarriedModalOpen.employeeId,
                  employeeEmail: isCarriedModalOpen.email,
                  amount,
                  reason,
                  createdAt: new Date().toISOString()
                });
              } catch (e) {
                handleFirestoreError(e, OperationType.CREATE, 'carriedRecords');
              }
              setIsCarriedModalOpen(null);
            }}
            onDelete={(id) => handleDeleteRecord('carriedRecords', id)}
          />
        )}
        {isEditUserModalOpen && (
          <EditUserModal 
            user={isEditUserModalOpen}
            onClose={() => setIsEditUserModalOpen(null)}
            onSave={async (data) => {
              try {
                await updateDoc(doc(db, 'employees', isEditUserModalOpen.employeeId), data);
              } catch (e) {
                handleFirestoreError(e, OperationType.UPDATE, `employees/${isEditUserModalOpen.employeeId}`);
              }
              setIsEditUserModalOpen(null);
            }}
            onDelete={async () => {
              setConfirmConfig({
                title: '직원 삭제',
                message: `${isEditUserModalOpen.displayName} 직원을 삭제하시겠습니까? 관련 데이터는 유지되지만 목록에서 사라집니다.`,
                onConfirm: async () => {
                  try {
                    const batch = writeBatch(db);
                    batch.delete(doc(db, 'employees', isEditUserModalOpen.employeeId));
                    if (isEditUserModalOpen.uid) {
                      batch.delete(doc(db, 'employees_meta', isEditUserModalOpen.uid));
                    }
                    await batch.commit();
                    setIsEditUserModalOpen(null);
                  } catch (e) {
                    handleFirestoreError(e, OperationType.DELETE, `employees/${isEditUserModalOpen.employeeId}`);
                  }
                  setConfirmConfig(null);
                }
              });
            }}
            onToggleRole={() => handleToggleRole(isEditUserModalOpen)}
            isSelf={isEditUserModalOpen.employeeId === profile.employeeId}
          />
        )}
        {isManageHistoryModalOpen && (
          <ManageHistoryModal 
            user={isManageHistoryModalOpen}
            requests={leaveRequests.filter(r => r.employeeId === isManageHistoryModalOpen.employeeId)}
            onClose={() => setIsManageHistoryModalOpen(null)}
            onAdd={async (data) => {
              try {
                await addDoc(collection(db, 'leaveRequests'), {
                  ...data,
                  employeeId: isManageHistoryModalOpen.employeeId,
                  employeeEmail: isManageHistoryModalOpen.email,
                  employeeName: isManageHistoryModalOpen.displayName,
                  createdAt: new Date().toISOString(),
                  processedBy: profile?.employeeId,
                  processedAt: new Date().toISOString()
                });
              } catch (e) {
                handleFirestoreError(e, OperationType.CREATE, 'leaveRequests');
              }
            }}
            onUpdate={async (id, data) => {
              try {
                await updateDoc(doc(db, 'leaveRequests', id), {
                  ...data,
                  processedBy: profile?.employeeId,
                  processedAt: new Date().toISOString()
                });
              } catch (e) {
                handleFirestoreError(e, OperationType.UPDATE, `leaveRequests/${id}`);
              }
            }}
            onDelete={async (id) => {
              try {
                await deleteDoc(doc(db, 'leaveRequests', id));
              } catch (e) {
                handleFirestoreError(e, OperationType.DELETE, `leaveRequests/${id}`);
              }
            }}
          />
        )}
        {isAddEmployeeModalOpen && (
          <AddEmployeeModal 
            onClose={() => setIsAddEmployeeModalOpen(false)}
            onSubmit={async (data) => {
              try {
                // Check if email already exists
                const q = query(collection(db, 'employees'), where('email', '==', data.email));
                const snap = await getDocs(q);

                if (!snap.empty) {
                  setAlertConfig({ title: '등록 오류', message: '이미 등록된 이메일입니다.' });
                  return;
                }

                const employeeId = `EMP_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                await setDoc(doc(db, 'employees', employeeId), {
                  ...data,
                  employeeId,
                  role: 'user',
                  joinedAt: new Date().toISOString(),
                  photoURL: null,
                  uid: null,
                  adjustment: 0,
                  status: 'active'
                });
                setIsAddEmployeeModalOpen(false);
              } catch (e: any) {
                console.error('Add employee failed:', e);
                setAlertConfig({ title: '오류', message: '직원 등록 중 오류가 발생했습니다.' });
              }
            }}
          />
        )}
        {confirmConfig && (
          <ConfirmModal 
            title={confirmConfig.title}
            message={confirmConfig.message}
            onConfirm={confirmConfig.onConfirm}
            onCancel={() => setConfirmConfig(null)}
          />
        )}
        {alertConfig && (
          <AlertModal 
            title={alertConfig.title}
            message={alertConfig.message}
            onClose={() => setAlertConfig(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Subcomponents ---

const SidebarItem = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-200 font-semibold ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
    {icon} {label}
  </button>
);

const StatCard = ({ label, value, icon: Icon, color = "bg-white", textColor = "text-slate-900", labelColor = "text-slate-400", iconColor = "text-slate-200", isBig = false }: any) => (
  <div className={`${color} p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all`}>
    <div className="flex items-center justify-between mb-3">
      <span className={`text-[10px] font-black ${labelColor} uppercase tracking-widest`}>{label}</span>
      {Icon && <Icon size={16} className={iconColor} />}
    </div>
    <div className={`${isBig ? 'text-2xl' : 'text-xl'} font-black ${textColor}`}>{value}</div>
  </div>
);

const LeaveRequestModal = ({ onClose, onSubmit }: { onClose: () => void, onSubmit: (data: any) => void }) => {
  const [form, setForm] = useState({
    type: LeaveType.ANNUAL,
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    reason: ''
  });

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <h3 className="font-bold text-xl">휴가 신청</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><X size={20}/></button>
        </div>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">휴가 유형</label>
            <select className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.type} onChange={e => setForm({...form, type: e.target.value as LeaveType})}>
              {Object.entries(LEAVE_TYPE_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase">시작일</label>
              <input type="date" className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase">종료일</label>
              <input type="date" className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">사유</label>
            <textarea className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 h-24 resize-none" value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} placeholder="사유를 입력하세요" />
          </div>
          <button onClick={() => onSubmit(form)} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg hover:bg-indigo-700 transition-all">신청 완료</button>
        </div>
      </motion.div>
    </div>
  );
};

const RecordModal = ({ title, user, records, onClose, onSubmit, onDelete }: { title: string, user: Employee, records: any[], onClose: () => void, onSubmit: (amount: number, reason: string) => void, onDelete: (id: string) => void }) => {
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b pb-4">
          <h3 className="font-bold text-xl">{user.displayName}님 {title} 관리</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><X size={20}/></button>
        </div>
        
        <div className="space-y-6">
          <section className="bg-slate-50 p-6 rounded-2xl space-y-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">새 기록 추가</p>
            <div className="flex items-center justify-center gap-6">
              <button onClick={() => setAmount(prev => prev - 0.5)} className="w-12 h-12 rounded-xl bg-white border border-slate-200 font-bold text-xl shadow-sm">-</button>
              <span className="text-3xl font-black">{amount}일</span>
              <button onClick={() => setAmount(prev => prev + 0.5)} className="w-12 h-12 rounded-xl bg-indigo-600 text-white font-bold text-xl shadow-md shadow-indigo-100">+</button>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase">사유</label>
              <input className="w-full border-2 border-slate-100 p-3 rounded-xl bg-white" value={reason} onChange={e => setReason(e.target.value)} placeholder="지급 사유" />
            </div>
            <button onClick={() => onSubmit(amount, reason)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-lg hover:bg-indigo-600 transition-all">기록 추가</button>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">기존 내역 (삭제 가능)</p>
            {records.length === 0 ? (
              <p className="text-center py-8 text-slate-400 text-sm">기록이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {records.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl shadow-sm">
                    <div>
                      <p className="font-bold text-sm">{r.amount > 0 ? `+${r.amount}` : r.amount}일</p>
                      <p className="text-xs text-slate-500">{r.reason}</p>
                      <p className="text-[10px] text-slate-400">{format(safeParseISO(r.createdAt), 'yyyy-MM-dd')}</p>
                    </div>
                    <button 
                      onClick={() => onDelete(r.id)}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </motion.div>
    </div>
  );
};

const EditUserModal = ({ user, onClose, onSave, onDelete, onToggleRole, isSelf }: { 
  user: Employee, 
  onClose: () => void, 
  onSave: (data: any) => void, 
  onDelete: () => void,
  onToggleRole: () => void, 
  isSelf: boolean 
}) => {
  const [form, setForm] = useState({
    displayName: user.displayName || '',
    email: user.email,
    hireDate: user.hireDate,
    adjustment: user.adjustment || 0
  });

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <h3 className="font-bold text-xl">직원 정보 수정</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><X size={20}/></button>
        </div>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">이름</label>
            <input type="text" className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">이메일</label>
            <input type="email" className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">입사일</label>
            <input type="date" className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.hireDate} onChange={e => setForm({...form, hireDate: e.target.value})} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">연차 조정 (일)</label>
            <input 
              type="number" 
              step="0.5"
              className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" 
              value={form.adjustment} 
              onChange={e => setForm({...form, adjustment: parseFloat(e.target.value) || 0})} 
            />
            <p className="text-[10px] text-slate-500">기본 연차 부여 개수에 더하거나 뺍니다. (예: -1, 2)</p>
          </div>
          <div className="pt-4 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-400 mb-3 uppercase">권한 설정</p>
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
              <div>
                <p className="font-bold text-sm">관리자 권한</p>
                <p className="text-[10px] text-slate-500">시스템 설정 및 직원 휴가 승인 가능</p>
              </div>
              <button 
                onClick={onToggleRole} 
                disabled={isSelf}
                className={`w-14 h-7 rounded-full relative transition-all ${user.role === 'admin' ? 'bg-indigo-600' : 'bg-slate-300'} ${isSelf ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${user.role === 'admin' ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            {!isSelf && (
              <button onClick={onDelete} className="p-4 text-red-500 hover:bg-red-50 rounded-2xl transition-all border-2 border-transparent hover:border-red-100">
                <Trash2 size={20} />
              </button>
            )}
            <button onClick={() => onSave(form)} className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-lg hover:bg-indigo-600 transition-all">저장 완료</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const AddEmployeeModal = ({ onClose, onSubmit }: { onClose: () => void, onSubmit: (data: { email: string, displayName: string, hireDate: string }) => Promise<void> }) => {
  const [form, setForm] = useState({
    email: '',
    displayName: '',
    hireDate: format(new Date(), 'yyyy-MM-dd')
  });

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <h3 className="font-bold text-xl">직원 사전 등록</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><X size={20}/></button>
        </div>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">구글 이메일</label>
            <input 
              type="email" 
              className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" 
              value={form.email} 
              onChange={e => setForm({...form, email: e.target.value})} 
              placeholder="example@gmail.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">이름</label>
            <input 
              type="text" 
              className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" 
              value={form.displayName} 
              onChange={e => setForm({...form, displayName: e.target.value})} 
              placeholder="홍길동"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase">입사일</label>
            <input 
              type="date" 
              className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" 
              value={form.hireDate} 
              onChange={e => setForm({...form, hireDate: e.target.value})} 
            />
          </div>
          <button 
            onClick={() => onSubmit(form)} 
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg hover:bg-indigo-700 transition-all"
          >
            등록 완료
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const ManageHistoryModal = ({ user, requests, onClose, onAdd, onUpdate, onDelete }: { 
  user: Employee, 
  requests: LeaveRequest[], 
  onClose: () => void,
  onAdd: (data: any) => void,
  onUpdate: (id: string, data: any) => void,
  onDelete: (id: string) => void
}) => {
  const [isFormOpen, setIsFormOpen] = useState<LeaveRequest | boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'yyyy-mm-dd' }) as any[];
        
        // Expected columns: 유형, 시작일, 종료일, 사유, 상태
        data.forEach(row => {
          const typeMap: Record<string, LeaveType> = {
            '연차': LeaveType.ANNUAL,
            '오전반차': LeaveType.MORNING_HALF,
            '오후반차': LeaveType.AFTERNOON_HALF,
            '보너스': LeaveType.BONUS,
            '보너스오전반차': LeaveType.BONUS_MORNING_HALF,
            '보너스오후반차': LeaveType.BONUS_AFTERNOON_HALF,
            '생일': LeaveType.BIRTHDAY,
            '공가': LeaveType.OFFICIAL
          };
          const statusMap: Record<string, LeaveStatus> = {
            '대기': LeaveStatus.PENDING,
            '승인': LeaveStatus.APPROVED,
            '반려': LeaveStatus.REJECTED,
            '취소': LeaveStatus.CANCELLED
          };

          const type = typeMap[row['유형']] || LeaveType.ANNUAL;
          const status = statusMap[row['상태']] || LeaveStatus.APPROVED;
          const startDate = row['시작일'] || format(new Date(), 'yyyy-MM-dd');
          const endDate = row['종료일'] || startDate;
          const reason = row['사유'] || '엑셀 일괄 업로드';

          onAdd({ type, startDate, endDate, reason, status });
        });
        
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err) {
        console.error('Excel parsing error:', err);
        alert('엑셀 파일 형식이 올바르지 않습니다.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const template = [
      { '유형': '연차', '시작일': '2024-01-01', '종료일': '2024-01-01', '사유': '개인사정', '상태': '승인' },
      { '유형': '오전반차', '시작일': '2024-01-02', '종료일': '2024-01-02', '사유': '병원', '상태': '승인' }
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "휴가업로드_템플릿.xlsx");
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl p-8 flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center border-b pb-4 mb-6">
          <div className="flex items-center gap-3">
            <img src={user.photoURL || ''} className="w-10 h-10 rounded-full bg-slate-200" alt="" />
            <div>
              <h3 className="font-bold text-xl">{user.displayName} 휴가 내역 관리</h3>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="file" ref={fileInputRef} onChange={handleExcelUpload} accept=".xlsx, .xls" className="hidden" />
            <button onClick={downloadTemplate} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-xl transition-all" title="템플릿 다운로드">
              <Download size={20} />
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-all">
              <Upload size={16} /> 엑셀 업로드
            </button>
            <button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all">
              <Plus size={16} /> 내역 추가
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><X size={20}/></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {requests.length === 0 ? (
            <div className="text-center py-12 text-slate-400">등록된 휴가 내역이 없습니다.</div>
          ) : (
            requests.sort((a, b) => isAfter(safeParseISO(b.startDate), safeParseISO(a.startDate)) ? 1 : -1).map(req => (
              <div key={req.id} className="bg-slate-50 rounded-2xl p-5 flex items-center justify-between border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    req.status === LeaveStatus.APPROVED ? 'bg-emerald-100 text-emerald-600' :
                    req.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-600' : 
                    req.status === LeaveStatus.CANCELLED ? 'bg-slate-200 text-slate-500' : 'bg-amber-100 text-amber-600'
                  }`}>
                    {req.status === LeaveStatus.APPROVED ? <CheckCircle2 size={20} /> : req.status === LeaveStatus.REJECTED ? <XCircle size={20} /> : <Clock size={20} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold">{LEAVE_TYPE_LABELS[req.type]}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        req.status === LeaveStatus.APPROVED ? 'bg-emerald-50 text-emerald-700' :
                        req.status === LeaveStatus.REJECTED ? 'bg-red-50 text-red-700' : 
                        req.status === LeaveStatus.CANCELLED ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {STATUS_LABELS[req.status]}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      {req.startDate}{req.startDate !== req.endDate ? ` ~ ${req.endDate}` : ''} ({req.reason})
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setIsFormOpen(req)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all"><Edit2 size={18}/></button>
                  <button onClick={() => onDelete(req.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-all"><Trash2 size={18}/></button>
                </div>
              </div>
            ))
          )}
        </div>

        {isFormOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6">
              <h4 className="font-bold text-lg">{typeof isFormOpen === 'boolean' ? '휴가 내역 추가' : '휴가 내역 수정'}</h4>
              <LeaveHistoryForm 
                initialData={typeof isFormOpen === 'object' ? isFormOpen : undefined}
                onSubmit={(data) => {
                  if (typeof isFormOpen === 'object') {
                    onUpdate(isFormOpen.id, data);
                  } else {
                    onAdd(data);
                  }
                  setIsFormOpen(false);
                }}
                onCancel={() => setIsFormOpen(false)}
              />
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

const LeaveHistoryForm = ({ initialData, onSubmit, onCancel }: { initialData?: LeaveRequest, onSubmit: (data: any) => void, onCancel: () => void }) => {
  const [form, setForm] = useState({
    type: initialData?.type || LeaveType.ANNUAL,
    startDate: initialData?.startDate || format(new Date(), 'yyyy-MM-dd'),
    endDate: initialData?.endDate || format(new Date(), 'yyyy-MM-dd'),
    status: initialData?.status || LeaveStatus.APPROVED,
    reason: initialData?.reason || ''
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-400 uppercase">휴가 유형</label>
        <select className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.type} onChange={e => setForm({...form, type: e.target.value as LeaveType})}>
          {Object.entries(LEAVE_TYPE_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-400 uppercase">시작일</label>
          <input type="date" className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-400 uppercase">종료일</label>
          <input type="date" className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-400 uppercase">상태</label>
        <select className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 font-bold" value={form.status} onChange={e => setForm({...form, status: e.target.value as LeaveStatus})}>
          {Object.entries(STATUS_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-400 uppercase">사유</label>
        <textarea className="w-full border-2 border-slate-100 p-3 rounded-xl bg-slate-50 h-24 resize-none" value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} placeholder="사유를 입력하세요" />
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onCancel} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all">취소</button>
        <button onClick={() => onSubmit(form)} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all">저장</button>
      </div>
    </div>
  );
};

const ConfirmModal = ({ title, message, onConfirm, onCancel }: { title: string, message: string, onConfirm: () => void, onCancel: () => void }) => (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 space-y-6">
      <div className="space-y-2">
        <h3 className="font-bold text-xl">{title}</h3>
        <p className="text-slate-500 text-sm">{message}</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all">취소</button>
        <button onClick={onConfirm} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all">확인</button>
      </div>
    </motion.div>
  </div>
);

const AlertModal = ({ title, message, onClose }: { title: string, message: string, onClose: () => void }) => (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 space-y-6">
      <div className="space-y-2">
        <h3 className="font-bold text-xl">{title}</h3>
        <p className="text-slate-500 text-sm">{message}</p>
      </div>
      <button onClick={onClose} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all">확인</button>
    </motion.div>
  </div>
);
