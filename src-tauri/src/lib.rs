#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod config;
pub mod events;
pub mod ide_import;
pub mod logs;
pub mod models;
pub mod process;
pub mod resources;
pub mod state;

use std::sync::Arc;
use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};
use models::{AppConfig, BatchActionResult, ExportResult, Group, Id, IdeImportInput, IdeImportPreview, ImportPreview, LogPage, ResourceSnapshot, RuntimeSnapshot, Service};
use state::AppState;

#[tauri::command]
fn config_load(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<AppConfig, String> { config::load(&app, state.inner()) }

#[tauri::command]
fn config_save(config: AppConfig, state: State<'_, Arc<AppState>>) -> Result<(), String> { config::save(state.inner(), config) }

#[tauri::command]
fn config_import_preview(json: String, state: State<'_, Arc<AppState>>) -> Result<ImportPreview, String> { let current = state.config.lock().unwrap().clone(); config::import_preview(&json, &current) }

#[tauri::command]
fn config_import_apply(json: String, state: State<'_, Arc<AppState>>) -> Result<AppConfig, String> { config::import_apply(state.inner(), &json) }

#[tauri::command]
fn config_export(state: State<'_, Arc<AppState>>) -> Result<ExportResult, String> { config::export(&state.config.lock().unwrap()) }

#[tauri::command]
fn choose_project_directory() -> Result<Option<String>, String> { ide_import::choose_project_directory() }

#[tauri::command]
fn ide_import_preview(input: IdeImportInput, state: State<'_, Arc<AppState>>) -> Result<IdeImportPreview, String> {
    let stored = ide_import::preview(input)?;
    ide_import::store_preview(state.inner(), stored)
}

#[tauri::command]
fn ide_import_apply(preview: IdeImportPreview, selected_ids: Vec<String>, group_name: String, state: State<'_, Arc<AppState>>) -> Result<AppConfig, String> {
    ide_import::apply(state.inner(), &preview, selected_ids, group_name)
}

#[tauri::command]
fn group_upsert(group: Group, state: State<'_, Arc<AppState>>) -> Result<Group, String> { config::upsert_group(state.inner(), group) }

#[tauri::command]
fn group_delete(group_id: Id, state: State<'_, Arc<AppState>>) -> Result<(), String> { config::delete_group(state.inner(), &group_id) }

#[tauri::command]
fn service_upsert(service: Service, state: State<'_, Arc<AppState>>) -> Result<Service, String> { config::upsert_service(state.inner(), service) }

#[tauri::command]
fn service_delete(service_id: Id, state: State<'_, Arc<AppState>>) -> Result<(), String> { config::delete_service(state.inner(), &service_id) }

#[tauri::command]
fn service_start(service_id: Id, state: State<'_, Arc<AppState>>) -> Result<RuntimeSnapshot, String> { process::start(state.inner().clone(), service_id) }

#[tauri::command]
fn service_stop(service_id: Id, grace_ms: Option<u64>, state: State<'_, Arc<AppState>>) -> Result<RuntimeSnapshot, String> { process::stop(state.inner().clone(), service_id, grace_ms) }

#[tauri::command]
fn service_restart(service_id: Id, grace_ms: Option<u64>, state: State<'_, Arc<AppState>>) -> Result<RuntimeSnapshot, String> { process::restart(state.inner().clone(), service_id, grace_ms) }

#[tauri::command]
fn service_batch_action(service_ids: Vec<Id>, action: String, grace_ms: Option<u64>, state: State<'_, Arc<AppState>>) -> Result<Vec<BatchActionResult>, String> { if service_ids.is_empty() { return Ok(vec![]); } if !matches!(action.as_str(), "start" | "stop" | "restart") { return Err("不支持的批量操作".into()); } Ok(process::batch(state.inner().clone(), service_ids, action, grace_ms)) }

#[tauri::command]
fn runtime_snapshot(service_ids: Option<Vec<Id>>, state: State<'_, Arc<AppState>>) -> Vec<RuntimeSnapshot> { process::snapshots(state.inner(), service_ids) }

#[tauri::command]
fn resource_snapshot(service_ids: Option<Vec<Id>>, state: State<'_, Arc<AppState>>) -> Vec<ResourceSnapshot> { let snapshots = resources::collect(state.inner(), service_ids); for item in &snapshots { if let Some(sink) = state.sink() { sink.resource(item); } } snapshots }

#[tauri::command]
fn log_page(service_id: Id, after_seq: Option<u64>, limit: Option<usize>, state: State<'_, Arc<AppState>>) -> LogPage { let mut page = state.logs.page(&service_id, after_seq, limit.unwrap_or(200)); page.generation = process::snapshots(state.inner(), Some(vec![service_id])).first().and_then(|snapshot| snapshot.generation.clone()); page }

#[tauri::command]
fn open_service_url(service_id: Id, state: State<'_, Arc<AppState>>) -> Result<(), String> { let service = state.config.lock().unwrap().services.iter().find(|s| s.id == service_id).cloned().ok_or_else(|| "服务不存在".to_string())?; let url = service.url.filter(|url| url.starts_with("http://") || url.starts_with("https://")).ok_or_else(|| "服务 URL 为空或不是 HTTP(S) URL".to_string())?; std::process::Command::new("open").arg(url).spawn().map(|_| ()).map_err(|e| format!("打开 URL 失败: {e}")) }

fn perform_shutdown(app: &AppHandle, state: &Arc<AppState>) -> Result<(), String> {
    if !state.begin_shutdown() { return Err("应用正在退出".into()); }
    state.clear_quit_request();
    if let Some(sink) = state.sink() { sink.shutdown("stopping"); }
    let report = process::stop_all(state.clone());
    if report.errors.is_empty() {
        if let Some(sink) = state.sink() { sink.shutdown("completed"); }
        state.allow_exit();
        app.exit(0);
        Ok(())
    } else {
        let error = report.errors.join("；");
        if let Some(sink) = state.sink() { sink.shutdown_error("forced", &error); }
        state.clear_quit_request();
        state.abort_shutdown();
        if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        Err(error)
    }
}

#[tauri::command]
fn app_quit(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> { perform_shutdown(&app, state.inner()) }

#[tauri::command]
fn quit_request_pending(state: State<'_, Arc<AppState>>) -> bool { state.has_quit_request() }

#[tauri::command]
fn quit_request_cancel(state: State<'_, Arc<AppState>>) { state.clear_quit_request(); }

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn request_quit_confirmation(app: &AppHandle, state: &AppState) {
    if state.shutting_down.load(std::sync::atomic::Ordering::SeqCst) { return; }
    state.request_quit();
    show_main_window(app);
    let _ = app.emit("avenil://quit-requested", ());
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Avenil", true, None::<&str>)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
    let icon = app.default_window_icon().cloned().expect("Avenil 应用图标未配置");
    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                let state = app.state::<Arc<AppState>>();
                request_quit_confirmation(app, state.inner());
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let state = AppState::new();
    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |app| {
            config::load(app.handle(), &state)?;
            let log_root = app.path().app_data_dir()?.join("logs");
            state.logs.set_root(log_root);
            state.set_sink(Arc::new(events::TauriEventSink(app.handle().clone())));
            setup_tray(app)?;
            let resource_app = app.handle().clone();
            std::thread::spawn(move || loop { std::thread::sleep(std::time::Duration::from_secs(2)); let state = resource_app.state::<Arc<AppState>>(); for item in resources::collect(state.inner(), None) { if let Some(sink) = state.sink() { sink.resource(&item); } } });
            Ok(())
        })
        .on_window_event(|window, event| { if let WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); } })
        .invoke_handler(tauri::generate_handler![config_load, config_save, config_import_preview, config_import_apply, config_export, choose_project_directory, ide_import_preview, ide_import_apply, group_upsert, group_delete, service_upsert, service_delete, service_start, service_stop, service_restart, service_batch_action, runtime_snapshot, resource_snapshot, log_page, open_service_url, app_quit, quit_request_pending, quit_request_cancel])
        .build(tauri::generate_context!())
        .expect("Avenil 构建失败")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, code, .. } = event {
                let state = app.state::<Arc<AppState>>();
                // Only the exit request emitted by app.exit after cleanup may pass.
                if code.is_some() && state.exit_allowed.load(std::sync::atomic::Ordering::SeqCst) { return; }
                api.prevent_exit();
                // Keep blocking external exit requests while services are stopping.
                if state.shutting_down.load(std::sync::atomic::Ordering::SeqCst) { return; }
                request_quit_confirmation(app, state.inner());
            }
        });
}
