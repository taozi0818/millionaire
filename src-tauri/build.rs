fn main() {
  // 当图标文件变化时重新编译
  println!("cargo:rerun-if-changed=icons/tray-icon.png");
  println!("cargo:rerun-if-changed=icons/icon.png");
  tauri_build::build()
}
