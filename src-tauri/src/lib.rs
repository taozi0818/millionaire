use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, PhysicalPosition,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const WINDOW_LABEL: &str = "main";
const WINDOW_WIDTH: f64 = 280.0;
const WINDOW_HEIGHT: f64 = 300.0;
const CONFIG_FILE: &str = "config.json";

// 配置结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppConfig {
    shortcut_modifiers: Vec<String>,
    shortcut_key: String,
    window_width: f64,
    window_height: f64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcut_modifiers: vec!["Alt".to_string()],
            shortcut_key: "M".to_string(),
            window_width: WINDOW_WIDTH,
            window_height: WINDOW_HEIGHT,
        }
    }
}

// 全局置顶状态
static PINNED: AtomicBool = AtomicBool::new(false);

// 当前快捷键配置 (modifiers, key)
static CURRENT_SHORTCUT: Mutex<Option<(Vec<String>, String)>> = Mutex::new(None);

// 配置文件路径
static CONFIG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

// 获取配置文件路径
fn get_config_path() -> Option<PathBuf> {
    CONFIG_PATH.lock().ok()?.clone()
}

// 加载配置
fn load_config() -> AppConfig {
    if let Some(path) = get_config_path() {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    return config;
                }
            }
        }
    }
    AppConfig::default()
}

// 保存配置
fn save_config(config: &AppConfig) {
    if let Some(path) = get_config_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(content) = serde_json::to_string_pretty(config) {
            let _ = fs::write(path, content);
        }
    }
}

#[tauri::command]
fn set_pinned(pinned: bool) {
    PINNED.store(pinned, Ordering::SeqCst);
}

#[tauri::command]
fn get_pinned() -> bool {
    PINNED.load(Ordering::SeqCst)
}

// 解析修饰键
fn parse_modifiers(mods: &[String]) -> Option<Modifiers> {
    if mods.is_empty() {
        return None;
    }
    let mut result = Modifiers::empty();
    for m in mods {
        match m.to_uppercase().as_str() {
            "ALT" | "OPTION" => result |= Modifiers::ALT,
            "CTRL" | "CONTROL" => result |= Modifiers::CONTROL,
            "SHIFT" => result |= Modifiers::SHIFT,
            "META" | "COMMAND" | "CMD" | "SUPER" => result |= Modifiers::META,
            _ => {}
        }
    }
    Some(result)
}

// 解析按键
fn parse_key(key: &str) -> Option<Code> {
    match key.to_uppercase().as_str() {
        "A" => Some(Code::KeyA),
        "B" => Some(Code::KeyB),
        "C" => Some(Code::KeyC),
        "D" => Some(Code::KeyD),
        "E" => Some(Code::KeyE),
        "F" => Some(Code::KeyF),
        "G" => Some(Code::KeyG),
        "H" => Some(Code::KeyH),
        "I" => Some(Code::KeyI),
        "J" => Some(Code::KeyJ),
        "K" => Some(Code::KeyK),
        "L" => Some(Code::KeyL),
        "M" => Some(Code::KeyM),
        "N" => Some(Code::KeyN),
        "O" => Some(Code::KeyO),
        "P" => Some(Code::KeyP),
        "Q" => Some(Code::KeyQ),
        "R" => Some(Code::KeyR),
        "S" => Some(Code::KeyS),
        "T" => Some(Code::KeyT),
        "U" => Some(Code::KeyU),
        "V" => Some(Code::KeyV),
        "W" => Some(Code::KeyW),
        "X" => Some(Code::KeyX),
        "Y" => Some(Code::KeyY),
        "Z" => Some(Code::KeyZ),
        "0" | "DIGIT0" => Some(Code::Digit0),
        "1" | "DIGIT1" => Some(Code::Digit1),
        "2" | "DIGIT2" => Some(Code::Digit2),
        "3" | "DIGIT3" => Some(Code::Digit3),
        "4" | "DIGIT4" => Some(Code::Digit4),
        "5" | "DIGIT5" => Some(Code::Digit5),
        "6" | "DIGIT6" => Some(Code::Digit6),
        "7" | "DIGIT7" => Some(Code::Digit7),
        "8" | "DIGIT8" => Some(Code::Digit8),
        "9" | "DIGIT9" => Some(Code::Digit9),
        "F1" => Some(Code::F1),
        "F2" => Some(Code::F2),
        "F3" => Some(Code::F3),
        "F4" => Some(Code::F4),
        "F5" => Some(Code::F5),
        "F6" => Some(Code::F6),
        "F7" => Some(Code::F7),
        "F8" => Some(Code::F8),
        "F9" => Some(Code::F9),
        "F10" => Some(Code::F10),
        "F11" => Some(Code::F11),
        "F12" => Some(Code::F12),
        "SPACE" => Some(Code::Space),
        "ENTER" => Some(Code::Enter),
        "ESCAPE" | "ESC" => Some(Code::Escape),
        "TAB" => Some(Code::Tab),
        _ => None,
    }
}

#[tauri::command]
fn update_shortcut(app: AppHandle, modifiers: Vec<String>, key: String) -> Result<String, String> {
    // 解析新快捷键
    let mods = parse_modifiers(&modifiers);
    let code = parse_key(&key).ok_or_else(|| format!("无效的按键: {}", key))?;
    let new_shortcut = Shortcut::new(mods, code);

    // 获取当前快捷键并注销
    let mut current = CURRENT_SHORTCUT.lock().map_err(|e| e.to_string())?;
    if let Some((old_mods, old_key)) = current.as_ref() {
        if let Some(old_code) = parse_key(old_key) {
            let old_shortcut = Shortcut::new(parse_modifiers(old_mods), old_code);
            let _ = app.global_shortcut().unregister(old_shortcut);
        }
    }

    // 注册新快捷键
    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| format!("注册快捷键失败: {}", e))?;

    // 保存新快捷键配置到内存
    *current = Some((modifiers.clone(), key.clone()));

    // 持久化到文件
    let mut config = load_config();
    config.shortcut_modifiers = modifiers.clone();
    config.shortcut_key = key.clone();
    save_config(&config);

    // 返回显示用的快捷键字符串
    let display = format_shortcut_display(&modifiers, &key);
    Ok(display)
}

#[tauri::command]
fn get_shortcut() -> (Vec<String>, String) {
    let current = CURRENT_SHORTCUT.lock().unwrap();
    current.clone().unwrap_or_else(|| (vec!["Alt".to_string()], "M".to_string()))
}

#[tauri::command]
fn save_window_size(width: f64, height: f64) {
    let mut config = load_config();
    config.window_width = width;
    config.window_height = height;
    save_config(&config);
}

fn format_shortcut_display(modifiers: &[String], key: &str) -> String {
    let mut parts = Vec::new();
    for m in modifiers {
        match m.to_uppercase().as_str() {
            "ALT" | "OPTION" => parts.push("⌥"),
            "CTRL" | "CONTROL" => parts.push("⌃"),
            "SHIFT" => parts.push("⇧"),
            "META" | "COMMAND" | "CMD" | "SUPER" => parts.push("⌘"),
            _ => {}
        }
    }
    parts.push(key);
    parts.join("")
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        // 获取主显示器并定位到右上角
        if let Some(monitor) = window.primary_monitor().ok().flatten() {
            let screen_size = monitor.size();
            let scale_factor = monitor.scale_factor();

            // 获取当前窗口大小
            let window_size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(
                (WINDOW_WIDTH * scale_factor) as u32,
                (WINDOW_HEIGHT * scale_factor) as u32,
            ));

            let margin = (10.0 * scale_factor) as i32;
            let top_margin = (30.0 * scale_factor) as i32;

            let x = screen_size.width as i32 - window_size.width as i32 - margin;
            let y = top_margin;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_window(app);
        }
    }
}

fn create_window(app: &tauri::AppHandle, config: &AppConfig) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::default())
        .title("Millionaire")
        .inner_size(config.window_width, config.window_height)
        .min_inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .visible(false)
        .skip_taskbar(true)
        .build()?;

    let window_clone = window.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Focused(focused) => {
                // 置顶模式下不自动隐藏
                if !focused && !PINNED.load(Ordering::SeqCst) {
                    let _ = window_clone.hide();
                }
            }
            tauri::WindowEvent::Resized(size) => {
                // 保存窗口大小
                let scale = window_clone.scale_factor().unwrap_or(1.0);
                let width = size.width as f64 / scale;
                let height = size.height as f64 / scale;
                let mut config = load_config();
                config.window_width = width;
                config.window_height = height;
                save_config(&config);
            }
            _ => {}
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![set_pinned, get_pinned, update_shortcut, get_shortcut, save_window_size])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // 任何已注册的快捷键触发时都切换窗口
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // 初始化配置文件路径
            if let Some(app_data_dir) = app.path().app_data_dir().ok() {
                let config_path = app_data_dir.join(CONFIG_FILE);
                if let Ok(mut path) = CONFIG_PATH.lock() {
                    *path = Some(config_path);
                }
            }

            // 加载配置
            let config = load_config();

            // 创建窗口
            create_window(app.handle(), &config)?;

            // 创建托盘菜单 - 左键点击直接显示菜单
            let shortcut_display = format_shortcut_display(&config.shortcut_modifiers, &config.shortcut_key);
            let show_item = MenuItem::with_id(app, "show", format!("显示面板 ({})", shortcut_display), true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // 获取配置中的 tray icon
            let tray = app.tray_by_id("main").expect("tray not found");
            tray.set_menu(Some(menu))?;
            tray.set_show_menu_on_left_click(true)?;
            tray.on_menu_event(|app, event| {
                match event.id.as_ref() {
                    "show" => show_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                }
            });

            // 注册快捷键（从配置加载）
            if let Some(code) = parse_key(&config.shortcut_key) {
                let mods = parse_modifiers(&config.shortcut_modifiers);
                let shortcut = Shortcut::new(mods, code);
                app.global_shortcut().register(shortcut)?;
            }

            // 初始化快捷键配置到内存
            let mut current = CURRENT_SHORTCUT.lock().unwrap();
            *current = Some((config.shortcut_modifiers.clone(), config.shortcut_key.clone()));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
