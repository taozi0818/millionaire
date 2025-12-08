import { useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PushpinOutlined,
  PushpinFilled,
  SyncOutlined,
  SettingOutlined,
  PoweroffOutlined,
  PlusOutlined,
  CloseOutlined,
  CheckOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  SwapOutlined,
  BarsOutlined,
} from "@ant-design/icons";

// 自定义 Tooltip 组件
function Tooltip({ children, text }: { children: ReactNode; text: string; }) {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPosition({ x: rect.left + rect.width / 2, y: rect.bottom + 4 });
    timeoutRef.current = window.setTimeout(() => setShow(true), 200);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShow(false);
  };

  return (
    <div
      ref={containerRef}
      className="tooltip-container"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {show && (
        <div
          className="tooltip"
          style={{ left: position.x, top: position.y }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

interface Stock {
  code: string;
  name: string;
  market: string;
  price: number;
  change: number;
  changePercent: number;
  trend?: number[]; // 分时走势数据
}

interface StockConfig {
  code: string;
  market: string;
}

// 默认自选股列表
const DEFAULT_STOCKS: StockConfig[] = [
  { code: "000001", market: "1" }, // 上证指数
  { code: "399001", market: "0" }, // 深证成指
  { code: "600519", market: "1" }, // 贵州茅台
  { code: "000858", market: "0" }, // 五粮液
  { code: "300750", market: "0" }, // 宁德时代
];

const STORAGE_KEY = "millionaire_stocks";

// 从本地存储加载股票配置
function loadStockConfigs(): StockConfig[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const configs = JSON.parse(saved);
      if (Array.isArray(configs) && configs.length > 0) {
        return configs;
      }
    }
  } catch (e) {
    console.error("Failed to load stock configs:", e);
  }
  return DEFAULT_STOCKS;
}

// 保存股票配置到本地存储
function saveStockConfigs(configs: StockConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch (e) {
    console.error("Failed to save stock configs:", e);
  }
}

// 根据股票代码判断市场
// 6开头 = 上海(1), 0/3开头 = 深圳(0)
function getMarketByCode(code: string): string {
  if (code.startsWith("6")) return "1";
  return "0";
}

// 构建东方财富 API 的 secids 参数
function buildSecids(stocks: StockConfig[]): string {
  return stocks.map((s) => `${s.market}.${s.code}`).join(",");
}

interface SearchResult {
  code: string;
  name: string;
  market: string;
}

// 解码 Unicode 转义序列 (如 \u8d35\u5dde\u8305\u53f0 -> 贵州茅台)
function decodeUnicode(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );
}

interface EastMoneyResponseItem {
  f2: number;  // 当前价格
  f3: number;  // 涨跌幅 %
  f4: number;  // 涨跌额
  f12: string; // 代码
  f13: number; // 市场 (0=深圳, 1=上海)
  f14: string; // 名称
}

async function fetchStockData(stocks: StockConfig[]): Promise<Stock[]> {
  if (stocks.length === 0) return [];

  const secids = buildSecids(stocks);
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f12,f13,f14,f2,f3,f4`;

  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    if (!data.data?.diff) return [];

    return (data.data.diff as EastMoneyResponseItem[]).map((item) => ({
      code: item.f12,
      name: item.f14,
      market: String(item.f13),  // 直接使用 API 返回的市场信息
      price: item.f2,
      change: item.f4,
      changePercent: item.f3,
    }));
  } catch (error) {
    console.error("Failed to fetch stock data:", error);
    return [];
  }
}

// 搜索股票 (使用腾讯搜索 API)
// 返回格式: v_hint="市场~代码~名称~拼音~类型^..."
async function searchStock(keyword: string): Promise<SearchResult[]> {
  if (!keyword.trim()) return [];

  const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(keyword)}&t=all`;
  console.log("[Search] URL:", url);

  try {
    const response = await fetch(url, { method: "GET" });
    console.log("[Search] Response status:", response.status);
    if (!response.ok) {
      console.log("[Search] Response not ok");
      return [];
    }

    const rawText = await response.text();
    console.log("[Search] Response text:", rawText);

    // 解码 Unicode 转义序列
    const text = decodeUnicode(rawText);
    console.log("[Search] Decoded text:", text);

    // 解析格式: v_hint="sh~600519~贵州茅台~gzmt~GP-A^sz~000858~五粮液~wly~GP-A"
    const match = text.match(/v_hint="([^"]*)"/);
    console.log("[Search] Match:", match);
    if (!match || !match[1]) return [];

    const results: SearchResult[] = [];
    const items = match[1].split("^");

    for (const item of items) {
      const parts = item.split("~");
      if (parts.length >= 5) {
        const [marketCode, code, name, , type] = parts;
        // A股 (GP-A) 和 指数 (ZS)
        if ((type === "GP-A" || type === "ZS") && (marketCode === "sh" || marketCode === "sz")) {
          results.push({
            code,
            name,
            market: marketCode === "sh" ? "1" : "0",
          });
        }
      }
    }

    console.log("[Search] Results:", results);
    return results.slice(0, 5);
  } catch (error) {
    console.error("[Search] Failed:", error);
    return [];
  }
}

type SortOrder = "none" | "asc" | "desc";

// 判断当前是否在A股交易时段
// 交易时间: 周一至周五 9:15-11:30, 12:59-15:00
function isTradingTime(): boolean {
  const now = new Date();
  const day = now.getDay();

  // 周末不交易
  if (day === 0 || day === 6) return false;

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const time = hours * 60 + minutes;

  // 上午 9:15-11:30 (555-690)
  // 下午 12:59-15:00 (779-900)
  return (time >= 555 && time <= 690) || (time >= 779 && time <= 900);
}

// 获取分时数据 (东方财富分时API)
async function fetchTrendData(market: string, code: string): Promise<number[]> {
  const secid = `${market}.${code}`;
  const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1&fields2=f51,f52,f53`;

  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return [];

    const data = await response.json();
    if (!data.data?.trends) return [];

    // trends 格式: "时间,开盘,收盘,最高,最低,成交量,成交额,均价"
    // 我们只需要收盘价 (第3个字段)
    return data.data.trends.map((t: string) => {
      const parts = t.split(",");
      return parseFloat(parts[2]) || 0;
    }).filter((p: number) => p > 0);
  } catch (error) {
    console.error("Failed to fetch trend data:", error);
    return [];
  }
}

// 并发控制函数
async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing: Promise<void>[] = [];

  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);

    if (poolLimit <= array.length) {
      const e: Promise<void> = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
      });
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

// 迷你走势图组件
function MiniTrendChart({ data, isUp }: { data: number[]; isUp: boolean; }) {
  if (!data || data.length < 2) return null;

  const width = 50;
  const height = 20;
  const padding = 1;
  const TOTAL_POINTS = 241; // A股全天交易时间 9:30-15:00 约241个点

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // 昨收价 (第一个数据点)
  const prevClose = data[0];
  const prevCloseY = height - padding - ((prevClose - min) / range) * (height - 2 * padding);

  // 采样点 (保持时间轴比例)
  const step = Math.ceil(TOTAL_POINTS / 30);
  const pointsArr = [];

  for (let i = 0; i < data.length; i += step) {
    const x = padding + (i / (TOTAL_POINTS - 1)) * (width - 2 * padding);
    const y = height - padding - ((data[i] - min) / range) * (height - 2 * padding);
    pointsArr.push(`${x},${y}`);
  }

  // 确保包含最新的数据点
  if ((data.length - 1) % step !== 0) {
    const i = data.length - 1;
    const x = padding + (i / (TOTAL_POINTS - 1)) * (width - 2 * padding);
    const y = height - padding - ((data[i] - min) / range) * (height - 2 * padding);
    pointsArr.push(`${x},${y}`);
  }

  const points = pointsArr.join(" ");

  const color = isUp ? "#ff453a" : "#34c759";

  return (
    <svg width={width} height={height} className="mini-trend-chart">
      {/* 水平基准线 (昨收价) */}
      <line
        x1={padding}
        y1={prevCloseY}
        x2={width - padding}
        y2={prevCloseY}
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="1"
        strokeDasharray="2,2"
      />
      {/* 走势线 */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 可排序股票项组件
interface SortableStockItemProps {
  stock: Stock;
  stockKey: string;
  showName: boolean;
  trendData: number[];
  onDelete: (market: string, code: string) => void;
  getPriceClass: (change: number) => string;
  formatPercent: (percent: number) => string;
  disabled: boolean;
}

function SortableStockItem({
  stock,
  stockKey,
  showName,
  trendData,
  onDelete,
  getPriceClass,
  formatPercent,
  disabled,
}: SortableStockItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({
    id: stockKey,
    disabled,
    animateLayoutChanges: () => false, // 禁用动画延迟
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="stock-item"
      {...attributes}
      {...listeners}
    >
      <div className="stock-info">
        {showName && <span className="stock-name">{stock.name}</span>}
        <span className="stock-code">{stock.code}</span>
      </div>
      <div className="stock-trend">
        <MiniTrendChart
          data={trendData}
          isUp={stock.change >= 0}
        />
      </div>
      <div className="stock-price-info">
        <span className={`stock-price ${getPriceClass(stock.change)}`}>
          {stock.price.toFixed(2)}
        </span>
        <span className={`stock-change ${getPriceClass(stock.change)}`}>
          {formatPercent(stock.changePercent)}
        </span>
      </div>
      <Tooltip text="删除">
        <button
          className="stock-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(stock.market, stock.code);
          }}
        >
          <CloseOutlined />
        </button>
      </Tooltip>
    </div>
  );
}

export function StockPanel() {
  const [stockConfigs, setStockConfigs] = useState<StockConfig[]>(loadStockConfigs);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [updateTime, setUpdateTime] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<number | null>(null);

  // 排序状态
  const [sortOrder, setSortOrder] = useState<SortOrder>("none");

  // 分时数据
  const [trendData, setTrendData] = useState<Record<string, number[]>>({});

  // 置顶状态
  const [isPinned, setIsPinned] = useState(false);

  // 显示股票名称
  const [showName, setShowName] = useState(true);

  // 自动刷新开关
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 刷新间隔(秒)，默认 10s，最小 10s
  const [refreshInterval, setRefreshInterval] = useState(() => {
    const saved = localStorage.getItem("millionaire_refresh_interval");
    const parsed = parseInt(saved || "", 10);
    return (!isNaN(parsed) && parsed >= 10) ? parsed : 10;
  });

  // 设置面板
  const [showSettings, setShowSettings] = useState(false);
  const [shortcutDisplay, setShortcutDisplay] = useState("⌥M");
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<{ modifiers: string[]; key: string; } | null>(null);

  // 使用 ref 存储 configs，避免 refreshData 依赖 state 导致频繁重建
  const stockConfigsRef = useRef(stockConfigs);
  stockConfigsRef.current = stockConfigs;

  const refreshData = useCallback(async () => {
    try {
      const data = await fetchStockData(stockConfigsRef.current);
      if (data.length > 0) {
        setStocks(data);
        setUpdateTime(new Date());
        setError(null);
      }
    } catch (err) {
      setError("获取数据失败");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    const timer = setInterval(() => {
      // 只在开启自动刷新且在交易时段内才刷新
      if (autoRefresh && isTradingTime()) {
        refreshData();
      }
    }, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [refreshData, autoRefresh, refreshInterval]);

  // 保存股票配置到本地存储，并立即刷新数据
  useEffect(() => {
    saveStockConfigs(stockConfigs);
    // 当 stockConfigs 变化时立即刷新数据
    refreshData();
  }, [stockConfigs, refreshData]);

  // 保存刷新间隔配置
  useEffect(() => {
    localStorage.setItem("millionaire_refresh_interval", refreshInterval.toString());
  }, [refreshInterval]);

  // 获取分时数据 - 仅在添加新股票时获取新数据
  const prevConfigsRef = useRef<StockConfig[]>([]);

  useEffect(() => {
    const prevKeys = new Set(prevConfigsRef.current.map(c => `${c.market}.${c.code}`));
    const newConfigs = stockConfigs.filter(c => !prevKeys.has(`${c.market}.${c.code}`));
    prevConfigsRef.current = stockConfigs;

    // 只获取新添加的股票分时数据
    if (newConfigs.length > 0) {
      asyncPool(15, newConfigs, async (config) => {
        const trend = await fetchTrendData(config.market, config.code);
        return { key: `${config.market}.${config.code}`, trend };
      }).then(results => {
        setTrendData(current => {
          const updated = { ...current };
          results.forEach(({ key, trend }) => {
            if (trend.length > 0) {
              updated[key] = trend;
            }
          });
          return updated;
        });
      });
    }
  }, [stockConfigs]);

  // 分时数据定时全量更新
  useEffect(() => {
    // 初次加载时获取全部分时数据
    const fetchAllTrends = async () => {
      const configs = stockConfigsRef.current;
      const results: Record<string, number[]> = {};
      await asyncPool(15, configs, async (config) => {
        const trend = await fetchTrendData(config.market, config.code);
        if (trend.length > 0) {
          results[`${config.market}.${config.code}`] = trend;
        }
      });
      setTrendData(results);
    };

    fetchAllTrends();

    // 每30秒全量更新
    const timer = setInterval(() => {
      if (autoRefresh && isTradingTime()) {
        fetchAllTrends();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  // 搜索防抖
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    searchTimeoutRef.current = window.setTimeout(async () => {
      setIsSearching(true);
      const results = await searchStock(searchQuery);
      setSearchResults(results);
      setShowSearchResults(true);
      setIsSearching(false);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const handleAddStock = (result: SearchResult) => {
    // 检查是否已存在 (使用 market + code 判断)
    if (stockConfigs.some((s) => s.market === result.market && s.code === result.code)) {
      setSearchQuery("");
      setShowSearchResults(false);
      return;
    }

    setStockConfigs((prev) => [...prev, { code: result.code, market: result.market }]);
    setSearchQuery("");
    setShowSearchResults(false);
  };

  const handleAddByCode = () => {
    const code = searchQuery.trim();
    if (!code || !/^\d{6}$/.test(code)) return;

    const market = getMarketByCode(code);

    // 检查是否已存在 (使用 market + code 判断)
    if (stockConfigs.some((s) => s.market === market && s.code === code)) {
      setSearchQuery("");
      setShowSearchResults(false);
      return;
    }

    setStockConfigs((prev) => [...prev, { code, market }]);
    setSearchQuery("");
    setShowSearchResults(false);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getPriceClass = (change: number) => {
    if (change > 0) return "stock-up";
    if (change < 0) return "stock-down";
    return "stock-flat";
  };

  const formatPercent = (percent: number) => {
    const sign = percent >= 0 ? "+" : "";
    return `${sign}${percent.toFixed(2)}%`;
  };

  // 删除股票
  const handleDeleteStock = (market: string, code: string) => {
    setStockConfigs((prev) => prev.filter((s) => !(s.market === market && s.code === code)));
    setStocks((prev) => prev.filter((s) => !(s.market === market && s.code === code)));
  };

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 需要拖动 5px 才触发，避免误触
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // dnd-kit 拖拽结束
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = stockConfigs.findIndex(c => `${c.market}.${c.code}` === active.id);
      const newIndex = stockConfigs.findIndex(c => `${c.market}.${c.code}` === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        setStockConfigs(arrayMove(stockConfigs, oldIndex, newIndex));
        setSortOrder("none");
      }
    }
  };

  // 切换排序
  const toggleSort = () => {
    const nextOrder: SortOrder = sortOrder === "none" ? "desc" : sortOrder === "desc" ? "asc" : "none";
    setSortOrder(nextOrder);
  };

  // 获取排序后的股票列表
  const getSortedStocks = () => {
    if (sortOrder === "none") {
      // 按 stockConfigs 的顺序排列
      const stockMap = new Map(stocks.map(s => [`${s.market}.${s.code}`, s]));
      return stockConfigs
        .map(config => stockMap.get(`${config.market}.${config.code}`))
        .filter((s): s is Stock => s !== undefined);
    }
    return [...stocks].sort((a, b) => {
      if (sortOrder === "desc") return b.changePercent - a.changePercent;
      return a.changePercent - b.changePercent;
    });
  };

  // 获取排序图标
  const getSortIcon = () => {
    if (sortOrder === "desc") return <SortDescendingOutlined />;
    if (sortOrder === "asc") return <SortAscendingOutlined />;
    return <SwapOutlined />;
  };

  // 切换置顶状态
  const togglePin = async () => {
    const newPinned = !isPinned;
    setIsPinned(newPinned);
    await invoke("set_pinned", { pinned: newPinned });
  };

  // 加载当前快捷键
  useEffect(() => {
    invoke<[string[], string]>("get_shortcut").then(([mods, key]) => {
      setShortcutDisplay(formatShortcutDisplay(mods, key));
    });
  }, []);

  // 格式化快捷键显示
  const formatShortcutDisplay = (modifiers: string[], key: string) => {
    const parts: string[] = [];
    for (const m of modifiers) {
      switch (m.toUpperCase()) {
        case "ALT":
        case "OPTION":
          parts.push("⌥");
          break;
        case "CTRL":
        case "CONTROL":
          parts.push("⌃");
          break;
        case "SHIFT":
          parts.push("⇧");
          break;
        case "META":
        case "COMMAND":
        case "CMD":
        case "SUPER":
          parts.push("⌘");
          break;
      }
    }
    parts.push(key.toUpperCase());
    return parts.join("");
  };

  // 处理快捷键录制
  const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const modifiers: string[] = [];
    if (e.altKey) modifiers.push("Alt");
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.shiftKey) modifiers.push("Shift");
    if (e.metaKey) modifiers.push("Meta");

    // 使用 e.code 而不是 e.key，避免 Option 键产生特殊字符
    const code = e.code;

    // 忽略单独的修饰键
    if (["AltLeft", "AltRight", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(code)) {
      return;
    }

    // 需要至少一个修饰键
    if (modifiers.length === 0) {
      return;
    }

    // 转换按键码为按键名
    let keyName: string | null = null;
    if (code.startsWith("Key")) {
      // KeyA -> A, KeyB -> B, etc.
      keyName = code.slice(3);
    } else if (code.startsWith("Digit")) {
      // Digit0 -> 0, Digit1 -> 1, etc.
      keyName = code.slice(5);
    } else if (code.startsWith("F") && /^F\d+$/.test(code)) {
      // F1, F2, etc.
      keyName = code;
    } else if (code === "Space") {
      keyName = "Space";
    } else if (code === "Enter") {
      keyName = "Enter";
    } else if (code === "Escape") {
      keyName = "Escape";
    } else if (code === "Tab") {
      keyName = "Tab";
    }

    if (!keyName) {
      return; // 不支持的按键
    }

    setRecordedKeys({ modifiers, key: keyName });
  };

  // 保存快捷键
  const saveShortcut = async () => {
    if (!recordedKeys) return;

    try {
      const display = await invoke<string>("update_shortcut", {
        modifiers: recordedKeys.modifiers,
        key: recordedKeys.key,
      });
      setShortcutDisplay(display);
      setIsRecordingShortcut(false);
      setRecordedKeys(null);
    } catch (err) {
      console.error("Failed to update shortcut:", err);
      alert(`设置快捷键失败: ${err}`);
    }
  };

  // 取消录制
  const cancelRecording = () => {
    setIsRecordingShortcut(false);
    setRecordedKeys(null);
  };

  return (
    <div className="stock-panel">
      <div className="stock-panel-header">
        <span className="stock-panel-title">自选股</span>
        <div className="stock-panel-actions">
          <Tooltip text={isPinned ? "取消置顶" : "置顶面板"}>
            <button
              className={`pin-btn ${isPinned ? "pinned" : ""}`}
              onClick={togglePin}
            >
              {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
            </button>
          </Tooltip>
          <Tooltip text={showName ? "隐藏名称" : "显示名称"}>
            <button
              className={`name-btn ${showName ? "active" : ""}`}
              onClick={() => setShowName(!showName)}
            >
              <BarsOutlined />
            </button>
          </Tooltip>
          <Tooltip text="按涨跌幅排序">
            <button className="sort-btn" onClick={toggleSort}>
              {getSortIcon()}
            </button>
          </Tooltip>
          <Tooltip text={autoRefresh ? "关闭自动刷新" : "开启自动刷新"}>
            <button
              className={`refresh-btn ${autoRefresh ? "active" : ""}`}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <SyncOutlined />
            </button>
          </Tooltip>
          <span className="stock-panel-time">{formatTime(updateTime)}</span>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="search-container">
        <div className="search-input-wrapper">
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="输入代码或名称搜索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddByCode();
            }}
          />
          <Tooltip text="添加股票">
            <button
              className="search-add-btn"
              onClick={handleAddByCode}
              disabled={!/^\d{6}$/.test(searchQuery.trim())}
            >
              <PlusOutlined />
            </button>
          </Tooltip>
        </div>

        {/* 搜索结果下拉 */}
        {showSearchResults && (
          <div className="search-results">
            {isSearching ? (
              <div className="search-result-item search-loading">搜索中...</div>
            ) : searchResults.length > 0 ? (
              searchResults.map((result) => (
                <div
                  key={`${result.market}.${result.code}`}
                  className="search-result-item"
                  onClick={() => handleAddStock(result)}
                >
                  <span className="search-result-name">{result.name}</span>
                  <span className="search-result-code">{result.code}</span>
                </div>
              ))
            ) : (
              <div className="search-result-item search-empty">未找到结果</div>
            )}
          </div>
        )}
      </div>

      <div className="stock-list">
        {loading ? (
          <div className="stock-loading">加载中...</div>
        ) : error ? (
          <div className="stock-error">{error}</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={getSortedStocks().map((s) => `${s.market}.${s.code}`)}
              strategy={verticalListSortingStrategy}
            >
              {getSortedStocks().map((stock) => {
                const stockKey = `${stock.market}.${stock.code}`;
                return (
                  <SortableStockItem
                    key={stockKey}
                    stock={stock}
                    stockKey={stockKey}
                    showName={showName}
                    trendData={trendData[stockKey] || []}
                    onDelete={handleDeleteStock}
                    getPriceClass={getPriceClass}
                    formatPercent={formatPercent}
                    disabled={sortOrder !== "none"}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </div>
      <div className="divider" />
      <div className="menu-item" onClick={() => setShowSettings(!showSettings)}>
        <span className="menu-item-icon"><SettingOutlined /></span>
        <span>设置</span>
        <span className="menu-item-arrow">{showSettings ? "▼" : "▶"}</span>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="settings-panel" style={{ padding: "10px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", marginTop: "8px" }}>
          <div className="settings-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span className="settings-label">快捷键</span>
            <div style={{ width: isRecordingShortcut ? "140px" : "105px", display: "flex", justifyContent: "flex-end", transition: "width 0.2s" }}>
              {isRecordingShortcut ? (
                <div className="shortcut-recording" style={{ display: "flex", alignItems: "center", gap: "4px", width: "100%", justifyContent: "space-between" }}>
                  <input
                    type="text"
                    className="shortcut-input"
                    placeholder="按下快捷键..."
                    value={recordedKeys ? formatShortcutDisplay(recordedKeys.modifiers, recordedKeys.key) : ""}
                    onKeyDown={handleShortcutKeyDown}
                    autoFocus
                    readOnly
                    style={{
                      flex: 1,
                      padding: "4px 8px",
                      borderRadius: "4px",
                      border: "1px solid #444",
                      background: "#333",
                      color: "#fff",
                      fontSize: "12px",
                      textAlign: "center",
                      outline: "none"
                    }}
                  />
                  <button
                    className="shortcut-btn save"
                    onClick={saveShortcut}
                    disabled={!recordedKeys}
                    style={{ padding: "4px 8px", background: "#34c759", border: "none", borderRadius: "4px", cursor: "pointer", color: "#fff", display: "flex", alignItems: "center" }}
                  >
                    <CheckOutlined />
                  </button>
                  <button
                    className="shortcut-btn cancel"
                    onClick={cancelRecording}
                    style={{ padding: "4px 8px", background: "#ff453a", border: "none", borderRadius: "4px", cursor: "pointer", color: "#fff", display: "flex", alignItems: "center" }}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              ) : (
                <div
                  className="shortcut-display"
                  onClick={() => setIsRecordingShortcut(true)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    cursor: "pointer",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    background: "#333",
                    border: "1px solid #444"
                  }}
                >
                  <span className="shortcut-value" style={{ fontFamily: "monospace", fontWeight: "bold" }}>{shortcutDisplay}</span>
                  <span className="shortcut-edit" style={{ fontSize: "10px", color: "#888" }}>修改</span>
                </div>
              )}
            </div>
          </div>
          <div className="settings-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="settings-label">刷新间隔(秒)</span>
            <div style={{ width: "105px", display: "flex", justifyContent: "flex-end" }}>
              <input
                type="text"
                style={{
                  width: "100%",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  border: "1px solid #444",
                  background: "#333",
                  color: "#fff",
                  fontSize: "12px",
                  textAlign: "center",
                  outline: "none"
                }}
                value={refreshInterval}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^\d*$/.test(val)) {
                    setRefreshInterval(val === "" ? 0 : parseInt(val, 10));
                  }
                }}
                onBlur={() => {
                  if (refreshInterval < 10) setRefreshInterval(10);
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="menu-item">
        <span className="menu-item-icon"><PoweroffOutlined /></span>
        <span>退出</span>
      </div>
    </div>
  );
}
