import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type AppLanguage = 'zh-CN' | 'en' | 'ja' | 'ko' | 'es' | 'fr';
export type LanguagePreference = AppLanguage | 'system';

export const LANGUAGE_STORAGE_KEY = 'rundock.language';

type LocaleMessage = Record<AppLanguage, string>;

const messageTable = {
  'document.title': {
    'zh-CN': 'Avenil · 本地服务控制台', en: 'Avenil · Local Service Console', ja: 'Avenil · ローカルサービスコンソール', ko: 'Avenil · 로컬 서비스 콘솔', es: 'Avenil · Consola de servicios locales', fr: 'Avenil · Console de services locaux',
  },
  'brand.tagline': {
    'zh-CN': '让一切安静地运行。', en: 'A quiet place for things to run.', ja: '静かに動かすための場所。', ko: '조용히 실행되는 공간.', es: 'Un lugar tranquilo para ejecutar tus servicios.', fr: 'Un endroit calme pour faire tourner vos services.',
  },
  'demo.data': {
    'zh-CN': '演示数据', en: 'Demo data', ja: 'デモデータ', ko: '데모 데이터', es: 'Datos de demostración', fr: 'Données de démonstration',
  },
  'common.close': {
    'zh-CN': '关闭', en: 'Close', ja: '閉じる', ko: '닫기', es: 'Cerrar', fr: 'Fermer',
  },
  'sidebar.workspace': {
    'zh-CN': '工作区', en: 'Workspace', ja: 'ワークスペース', ko: '워크스페이스', es: 'Espacio de trabajo', fr: 'Espace de travail',
  },
  'sidebar.filterAria': {
    'zh-CN': '服务筛选', en: 'Service filters', ja: 'サービスフィルター', ko: '서비스 필터', es: 'Filtros de servicios', fr: 'Filtres de services',
  },
  'sidebar.allServices': {
    'zh-CN': '全部服务', en: 'All services', ja: 'すべてのサービス', ko: '모든 서비스', es: 'Todos los servicios', fr: 'Tous les services',
  },
  'sidebar.running': {
    'zh-CN': '运行中', en: 'Running', ja: '実行中', ko: '실행 중', es: 'En ejecución', fr: 'En cours',
  },
  'sidebar.stopped': {
    'zh-CN': '已停止', en: 'Stopped', ja: '停止済み', ko: '중지됨', es: 'Detenidos', fr: 'Arrêtés',
  },
  'sidebar.groups': {
    'zh-CN': '项目组', en: 'Projects', ja: 'プロジェクト', ko: '프로젝트', es: 'Proyectos', fr: 'Projets',
  },
  'sidebar.createGroup': {
    'zh-CN': '新建项目组', en: 'Create project', ja: 'プロジェクトを作成', ko: '프로젝트 만들기', es: 'Crear proyecto', fr: 'Créer un projet',
  },
  'sidebar.emptyGroups': {
    'zh-CN': '创建项目组，整理跨仓库服务', en: 'Create a project to organize services across repositories', ja: 'プロジェクトを作成して、リポジトリ間のサービスを整理しましょう', ko: '프로젝트를 만들어 여러 저장소의 서비스를 정리하세요', es: 'Crea un proyecto para organizar servicios de varios repositorios', fr: 'Créez un projet pour organiser les services de plusieurs dépôts',
  },
  'sidebar.actionsAria': {
    'zh-CN': '工作区操作', en: 'Workspace actions', ja: 'ワークスペースの操作', ko: '워크스페이스 작업', es: 'Acciones del espacio de trabajo', fr: "Actions de l'espace de travail",
  },
  'sidebar.addService': {
    'zh-CN': '添加服务', en: 'Add service', ja: 'サービスを追加', ko: '서비스 추가', es: 'Añadir servicio', fr: 'Ajouter un service',
  },
  'sidebar.settings': {
    'zh-CN': '设置', en: 'Settings', ja: '設定', ko: '설정', es: 'Ajustes', fr: 'Réglages',
  },
  'sidebar.groupMenuAria': {
    'zh-CN': '项目组“{name}”操作', en: 'Actions for {name}', ja: '{name}の操作', ko: '{name} 작업', es: 'Acciones para {name}', fr: 'Actions pour {name}',
  },
  'sidebar.editGroupAction': {
    'zh-CN': '编辑项目组', en: 'Edit project', ja: 'プロジェクトを編集', ko: '프로젝트 편집', es: 'Editar proyecto', fr: 'Modifier le projet',
  },
  'sidebar.deleteGroupAction': {
    'zh-CN': '删除项目组', en: 'Delete project', ja: 'プロジェクトを削除', ko: '프로젝트 삭제', es: 'Eliminar proyecto', fr: 'Supprimer le projet',
  },
  'main.allServices': {
    'zh-CN': '全部服务', en: 'All services', ja: 'すべてのサービス', ko: '모든 서비스', es: 'Todos los servicios', fr: 'Tous les services',
  },
  'main.startAll': {
    'zh-CN': '启动全部', en: 'Start all', ja: 'すべて起動', ko: '모두 시작', es: 'Iniciar todo', fr: 'Tout démarrer',
  },
  'main.restartAll': {
    'zh-CN': '重启全部', en: 'Restart all', ja: 'すべて再起動', ko: '모두 다시 시작', es: 'Reiniciar todo', fr: 'Tout redémarrer',
  },
  'main.stopAll': {
    'zh-CN': '停止全部', en: 'Stop all', ja: 'すべて停止', ko: '모두 중지', es: 'Detener todo', fr: 'Tout arrêter',
  },
  'main.shutdownNotice': {
    'zh-CN': '正在停止托管服务，暂时不能启动或重启服务。', en: 'Managed services are stopping. Starting or restarting is temporarily unavailable.', ja: '管理対象サービスを停止中です。起動と再起動は一時的に利用できません。', ko: '관리 중인 서비스를 중지하고 있습니다. 잠시 동안 시작하거나 다시 시작할 수 없습니다.', es: 'Los servicios administrados se están deteniendo. Iniciar o reiniciar no está disponible temporalmente.', fr: 'Les services gérés sont en cours d’arrêt. Le démarrage et le redémarrage sont temporairement indisponibles.',
  },
  'filter.all': {
    'zh-CN': '全部', en: 'All', ja: 'すべて', ko: '전체', es: 'Todos', fr: 'Tous',
  },
  'filter.running': {
    'zh-CN': '运行中', en: 'Running', ja: '実行中', ko: '실행 중', es: 'En ejecución', fr: 'En cours',
  },
  'filter.stopped': {
    'zh-CN': '已停止', en: 'Stopped', ja: '停止済み', ko: '중지됨', es: 'Detenidos', fr: 'Arrêtés',
  },
  'filter.results': {
    'zh-CN': '{count} 个结果', en: '{count} results', ja: '{count}件の結果', ko: '결과 {count}개', es: '{count} resultados', fr: '{count} résultats',
  },
  'loading.config': {
    'zh-CN': '正在载入本机配置…', en: 'Loading local configuration…', ja: 'ローカル設定を読み込み中…', ko: '로컬 구성을 불러오는 중…', es: 'Cargando la configuración local…', fr: 'Chargement de la configuration locale…',
  },
  'error.retry': {
    'zh-CN': '重试', en: 'Retry', ja: '再試行', ko: '다시 시도', es: 'Reintentar', fr: 'Réessayer',
  },
  'service.status.stopped': {
    'zh-CN': '已停止', en: 'Stopped', ja: '停止済み', ko: '중지됨', es: 'Detenido', fr: 'Arrêté',
  },
  'service.status.starting': {
    'zh-CN': '启动中', en: 'Starting', ja: '起動中', ko: '시작 중', es: 'Iniciando', fr: 'Démarrage',
  },
  'service.status.running': {
    'zh-CN': '运行中', en: 'Running', ja: '実行中', ko: '실행 중', es: 'En ejecución', fr: 'En cours',
  },
  'service.status.stopping': {
    'zh-CN': '停止中', en: 'Stopping', ja: '停止中', ko: '중지 중', es: 'Deteniendo', fr: 'Arrêt',
  },
  'service.status.exited': {
    'zh-CN': '已退出', en: 'Exited', ja: '終了', ko: '종료됨', es: 'Finalizado', fr: 'Terminé',
  },
  'service.status.failed': {
    'zh-CN': '启动失败', en: 'Failed to start', ja: '起動失敗', ko: '시작 실패', es: 'Error al iniciar', fr: 'Échec du démarrage',
  },
  'service.status.unknown': {
    'zh-CN': '状态未知', en: 'Unknown', ja: '不明', ko: '알 수 없음', es: 'Desconocido', fr: 'Inconnu',
  },
  'service.unnamed': {
    'zh-CN': '未命名服务', en: 'Unnamed service', ja: '名前のないサービス', ko: '이름 없는 서비스', es: 'Servicio sin nombre', fr: 'Service sans nom',
  },
  'service.ungrouped': {
    'zh-CN': '未分组', en: 'Unassigned', ja: '未分類', ko: '미분류', es: 'Sin asignar', fr: 'Non attribué',
  },
  'service.noCommand': {
    'zh-CN': '未配置命令', en: 'No command configured', ja: 'コマンド未設定', ko: '명령이 구성되지 않음', es: 'Sin comando configurado', fr: 'Aucune commande configurée',
  },
  'service.noPortCheck': {
    'zh-CN': '无端口检查', en: 'No port check', ja: 'ポートチェックなし', ko: '포트 검사 없음', es: 'Sin comprobación de puerto', fr: 'Aucun contrôle de port',
  },
  'service.hasError': {
    'zh-CN': '有错误', en: 'Error', ja: 'エラーあり', ko: '오류 있음', es: 'Error', fr: 'Erreur',
  },
  'service.waitingStart': {
    'zh-CN': '等待启动', en: 'Waiting to start', ja: '起動待ち', ko: '시작 대기 중', es: 'Esperando para iniciar', fr: 'En attente de démarrage',
  },
  'service.edit': {
    'zh-CN': '编辑服务', en: 'Edit service', ja: 'サービスを編集', ko: '서비스 편집', es: 'Editar servicio', fr: 'Modifier le service',
  },
  'service.delete': {
    'zh-CN': '删除服务', en: 'Delete service', ja: 'サービスを削除', ko: '서비스 삭제', es: 'Eliminar servicio', fr: 'Supprimer le service',
  },
  'service.start': {
    'zh-CN': '启动', en: 'Start', ja: '起動', ko: '시작', es: 'Iniciar', fr: 'Démarrer',
  },
  'service.stop': {
    'zh-CN': '停止', en: 'Stop', ja: '停止', ko: '중지', es: 'Detener', fr: 'Arrêter',
  },
  'service.restart': {
    'zh-CN': '重启', en: 'Restart', ja: '再起動', ko: '다시 시작', es: 'Reiniciar', fr: 'Redémarrer',
  },
  'service.expandDetails': {
    'zh-CN': '展开详情', en: 'Expand details', ja: '詳細を展開', ko: '세부 정보 펼치기', es: 'Expandir detalles', fr: 'Développer les détails',
  },
  'service.collapseDetails': {
    'zh-CN': '收起详情', en: 'Collapse details', ja: '詳細を折りたたむ', ko: '세부 정보 접기', es: 'Contraer detalles', fr: 'Réduire les détails',
  },
  'service.details': {
    'zh-CN': '{name} 服务详情', en: '{name} service details', ja: '{name}のサービス詳細', ko: '{name} 서비스 세부 정보', es: 'Detalles del servicio {name}', fr: 'Détails du service {name}',
  },
  'service.exitCode': {
    'zh-CN': '退出码 {code}', en: 'Exit code {code}', ja: '終了コード {code}', ko: '종료 코드 {code}', es: 'Código de salida {code}', fr: 'Code de sortie {code}',
  },
  'service.logs': {
    'zh-CN': '日志', en: 'Logs', ja: 'ログ', ko: '로그', es: 'Registros', fr: 'Journaux',
  },
  'service.fullscreenLogs': {
    'zh-CN': '全屏查看', en: 'View full screen', ja: '全画面で表示', ko: '전체 화면으로 보기', es: 'Ver en pantalla completa', fr: 'Afficher en plein écran',
  },
  'service.closeFullscreenLogs': {
    'zh-CN': '关闭全屏日志', en: 'Close full-screen logs', ja: '全画面ログを閉じる', ko: '전체 화면 로그 닫기', es: 'Cerrar registros en pantalla completa', fr: 'Fermer les journaux en plein écran',
  },
  'service.config': {
    'zh-CN': '配置', en: 'Config', ja: '設定', ko: '구성', es: 'Configuración', fr: 'Configuration',
  },
  'service.metrics': {
    'zh-CN': '指标', en: 'Metrics', ja: 'メトリクス', ko: '메트릭', es: 'Métricas', fr: 'Métriques',
  },
  'service.cpu': {
    'zh-CN': 'CPU', en: 'CPU', ja: 'CPU', ko: 'CPU', es: 'CPU', fr: 'CPU',
  },
  'service.memory': {
    'zh-CN': '内存', en: 'Memory', ja: 'メモリ', ko: '메모리', es: 'Memoria', fr: 'Mémoire',
  },
  'service.processCount': {
    'zh-CN': '进程数', en: 'Processes', ja: 'プロセス数', ko: '프로세스 수', es: 'Procesos', fr: 'Processus',
  },
  'service.pid': {
    'zh-CN': 'PID', en: 'PID', ja: 'PID', ko: 'PID', es: 'PID', fr: 'PID',
  },
  'service.closeDetails': {
    'zh-CN': '收起详情', en: 'Close details', ja: '詳細を閉じる', ko: '세부 정보 닫기', es: 'Cerrar detalles', fr: 'Fermer les détails',
  },
  'service.workdir': {
    'zh-CN': '工作目录', en: 'Working directory', ja: '作業ディレクトリ', ko: '작업 디렉터리', es: 'Directorio de trabajo', fr: 'Répertoire de travail',
  },
  'service.command': {
    'zh-CN': '启动命令', en: 'Start command', ja: '起動コマンド', ko: '시작 명령', es: 'Comando de inicio', fr: 'Commande de démarrage',
  },
  'service.shell': {
    'zh-CN': 'Shell', en: 'Shell', ja: 'Shell', ko: 'Shell', es: 'Shell', fr: 'Shell',
  },
  'service.port': {
    'zh-CN': '端口', en: 'Port', ja: 'ポート', ko: '포트', es: 'Puerto', fr: 'Port',
  },
  'service.env': {
    'zh-CN': '环境变量', en: 'Environment variables', ja: '環境変数', ko: '환경 변수', es: 'Variables de entorno', fr: "Variables d’environnement",
  },
  'service.envCount': {
    'zh-CN': '{count} 项', en: '{count} items', ja: '{count}項目', ko: '{count}개', es: '{count} elementos', fr: '{count} éléments',
  },
  'service.notConfigured': {
    'zh-CN': '未配置', en: 'Not configured', ja: '未設定', ko: '구성되지 않음', es: 'Sin configurar', fr: 'Non configuré',
  },
  'service.portDisabled': {
    'zh-CN': '未启用', en: 'Disabled', ja: '無効', ko: '사용 안 함', es: 'Desactivado', fr: 'Désactivé',
  },
  'service.logSingleFile': {
    'zh-CN': '{size} MB 单文件', en: '{size} MB per file', ja: '1ファイル {size} MB', ko: '파일당 {size} MB', es: '{size} MB por archivo', fr: '{size} Mo par fichier',
  },
  'service.logHistoryFiles': {
    'zh-CN': '{count} 个历史文件', en: '{count} history files', ja: '履歴ファイル {count}個', ko: '기록 파일 {count}개', es: '{count} archivos históricos', fr: '{count} fichiers historiques',
  },
  'service.logMemory': {
    'zh-CN': '{size} KB 内存', en: '{size} KB memory', ja: 'メモリ {size} KB', ko: '메모리 {size} KB', es: '{size} KB de memoria', fr: '{size} Ko de mémoire',
  },
  'service.logWarning': {
    'zh-CN': '较早日志已轮转或被丢弃', en: 'Earlier logs were rotated or discarded', ja: '以前のログはローテーションまたは破棄されました', ko: '이전 로그가 순환되었거나 삭제되었습니다', es: 'Los registros anteriores se rotaron o descartaron', fr: 'Les anciens journaux ont été archivés ou supprimés',
  },
  'service.logDropped': {
    'zh-CN': '（{count} 条）', en: ' ({count})', ja: '（{count}件）', ko: ' ({count}개)', es: ' ({count})', fr: ' ({count})',
  },
  'service.logsEmpty': {
    'zh-CN': '服务启动后，日志会显示在这里', en: 'Logs will appear here after the service starts', ja: 'サービスの起動後、ここにログが表示されます', ko: '서비스가 시작되면 여기에 로그가 표시됩니다', es: 'Los registros aparecerán aquí cuando se inicie el servicio', fr: 'Les journaux apparaîtront ici après le démarrage du service',
  },
  'service.startTime': {
    'zh-CN': '启动时间', en: 'Started at', ja: '起動時刻', ko: '시작 시간', es: 'Hora de inicio', fr: 'Démarré à',
  },
  'service.endTime': {
    'zh-CN': '结束时间', en: 'Ended at', ja: '終了時刻', ko: '종료 시간', es: 'Hora de finalización', fr: 'Terminé à',
  },
  'service.generation': {
    'zh-CN': '本次 generation', en: 'Current generation', ja: '現在の generation', ko: '현재 generation', es: 'Generation actual', fr: 'Generation actuelle',
  },
  'service.sampledAt': {
    'zh-CN': '采样于 {time}', en: 'Sampled at {time}', ja: '{time}にサンプリング', ko: '{time}에 샘플링됨', es: 'Muestreado a las {time}', fr: 'Échantillonné à {time}',
  },
  'settings.title': {
    'zh-CN': '设置', en: 'Settings', ja: '設定', ko: '설정', es: 'Ajustes', fr: 'Réglages',
  },
  'settings.subtitle': {
    'zh-CN': '调整 Avenil 的外观、语言与 CLI', en: 'Adjust Avenil appearance, language, and CLI', ja: 'Avenilの外観、言語、CLIを調整します', ko: 'Avenil의 모양, 언어 및 CLI를 조정합니다', es: 'Ajusta el aspecto, el idioma y la CLI de Avenil', fr: "Ajustez l’apparence, la langue et la CLI d’Avenil",
  },
  'settings.appearance': {
    'zh-CN': '外观', en: 'Appearance', ja: '外観', ko: '모양', es: 'Apariencia', fr: 'Apparence',
  },
  'settings.theme': {
    'zh-CN': '主题', en: 'Theme', ja: 'テーマ', ko: '테마', es: 'Tema', fr: 'Thème',
  },
  'settings.themeDescription': {
    'zh-CN': '选择外观，偏好会自动保存', en: 'Choose an appearance; your preference is saved automatically', ja: '外観を選択すると、設定が自動的に保存されます', ko: '모양을 선택하면 기본 설정이 자동으로 저장됩니다', es: 'Elige un aspecto; tu preferencia se guarda automáticamente', fr: 'Choisissez une apparence ; votre préférence est enregistrée automatiquement',
  },
  'settings.theme.system': {
    'zh-CN': '跟随系统', en: 'System', ja: 'システムに従う', ko: '시스템 설정', es: 'Sistema', fr: 'Système',
  },
  'settings.theme.light': {
    'zh-CN': '浅色', en: 'Light', ja: 'ライト', ko: '라이트', es: 'Claro', fr: 'Clair',
  },
  'settings.theme.dark': {
    'zh-CN': '深色', en: 'Dark', ja: 'ダーク', ko: '다크', es: 'Oscuro', fr: 'Sombre',
  },
  'settings.language': {
    'zh-CN': '语言', en: 'Language', ja: '言語', ko: '언어', es: 'Idioma', fr: 'Langue',
  },
  'settings.languageDescription': {
    'zh-CN': '选择界面语言，偏好会自动保存', en: 'Choose the interface language; your preference is saved automatically', ja: 'インターフェースの言語を選択すると、設定が自動的に保存されます', ko: '인터페이스 언어를 선택하면 기본 설정이 자동으로 저장됩니다', es: 'Elige el idioma de la interfaz; tu preferencia se guarda automáticamente', fr: "Choisissez la langue de l’interface ; votre préférence est enregistrée automatiquement",
  },
  'settings.language.system': {
    'zh-CN': '跟随系统', en: 'Follow system', ja: 'システムに従う', ko: '시스템 따르기', es: 'Seguir el sistema', fr: 'Suivre le système',
  },
  'settings.language.zh-CN': {
    'zh-CN': '简体中文', en: '简体中文', ja: '简体中文', ko: '简体中文', es: '简体中文', fr: '简体中文',
  },
  'settings.language.en': {
    'zh-CN': 'English', en: 'English', ja: 'English', ko: 'English', es: 'English', fr: 'English',
  },
  'settings.language.ja': {
    'zh-CN': '日本語', en: '日本語', ja: '日本語', ko: '日本語', es: '日本語', fr: '日本語',
  },
  'settings.language.ko': {
    'zh-CN': '한국어', en: '한국어', ja: '한국어', ko: '한국어', es: '한국어', fr: '한국어',
  },
  'settings.language.es': {
    'zh-CN': 'Español', en: 'Español', ja: 'Español', ko: 'Español', es: 'Español', fr: 'Español',
  },
  'settings.language.fr': {
    'zh-CN': 'Français', en: 'Français', ja: 'Français', ko: 'Français', es: 'Français', fr: 'Français',
  },
  'settings.cli.title': {
    'zh-CN': 'CLI 命令', en: 'Command-line CLI', ja: 'コマンドラインCLI', ko: '명령줄 CLI', es: 'CLI de línea de comandos', fr: 'CLI en ligne de commande',
  },
  'settings.cli.description': {
    'zh-CN': '让 shell 和 AI agent 直接控制 Avenil；命令会安装到当前用户目录。', en: 'Let shells and AI agents control Avenil directly; the command is installed for the current user.', ja: 'シェルやAIエージェントからAvenilを直接操作できます。コマンドは現在のユーザー用にインストールされます。', ko: '셸과 AI 에이전트에서 Avenil을 직접 제어합니다. 명령은 현재 사용자용으로 설치됩니다.', es: 'Permite que los shells y los agentes de IA controlen Avenil directamente; el comando se instala para el usuario actual.', fr: 'Permettez aux shells et aux agents IA de contrôler Avenil directement ; la commande est installée pour l’utilisateur actuel.',
  },
  'settings.cli.target': {
    'zh-CN': '命令位置', en: 'Command location', ja: 'コマンドの場所', ko: '명령 위치', es: 'Ubicación del comando', fr: 'Emplacement de la commande',
  },
  'settings.cli.install': {
    'zh-CN': '安装 CLI', en: 'Install CLI', ja: 'CLIをインストール', ko: 'CLI 설치', es: 'Instalar CLI', fr: 'Installer la CLI',
  },
  'settings.cli.installing': {
    'zh-CN': '正在安装…', en: 'Installing…', ja: 'インストール中…', ko: '설치 중…', es: 'Instalando…', fr: 'Installation…',
  },
  'settings.cli.installed': {
    'zh-CN': 'CLI 已安装', en: 'CLI installed', ja: 'CLIをインストール済み', ko: 'CLI 설치됨', es: 'CLI instalada', fr: 'CLI installée',
  },
  'settings.cli.conflict': {
    'zh-CN': '安装位置已存在其他文件：{path}', en: 'Another file already occupies the install path: {path}', ja: 'インストール先に別のファイルがあります：{path}', ko: '설치 경로에 다른 파일이 있습니다: {path}', es: 'Ya existe otro archivo en la ruta de instalación: {path}', fr: 'Un autre fichier occupe déjà le chemin d’installation : {path}',
  },
  'settings.cli.installCommand': {
    'zh-CN': '安装命令', en: 'Install command', ja: 'インストールコマンド', ko: '설치 명령', es: 'Comando de instalación', fr: 'Commande d’installation',
  },
  'settings.cli.pathConfigured': {
    'zh-CN': '当前应用的 PATH 已包含安装目录', en: 'The current app PATH includes the install directory', ja: '現在のアプリのPATHにインストール先が含まれています', ko: '현재 앱의 PATH에 설치 디렉터리가 포함되어 있습니다', es: 'El PATH actual de la aplicación incluye el directorio de instalación', fr: 'Le PATH actuel de l’application contient le répertoire d’installation',
  },
  'settings.cli.pathNotConfigured': {
    'zh-CN': '当前 PATH 尚未包含该目录；执行下面命令后，新终端即可直接使用 avenil。', en: 'The current PATH does not include this directory; run the command below, then new terminals can use avenil directly.', ja: '現在のPATHにこのディレクトリが含まれていません。下のコマンドを実行すると、新しいターミナルでavenilを直接使えます。', ko: '현재 PATH에 이 디렉터리가 없습니다. 아래 명령을 실행하면 새 터미널에서 avenil을 바로 사용할 수 있습니다.', es: 'El PATH actual no incluye este directorio; ejecuta el comando siguiente para usar avenil directamente en los nuevos terminales.', fr: 'Le PATH actuel ne contient pas ce répertoire ; exécutez la commande ci-dessous pour utiliser avenil directement dans les nouveaux terminaux.',
  },
  'settings.cli.pathCommand': {
    'zh-CN': '加入 PATH 命令', en: 'Add to PATH command', ja: 'PATHに追加するコマンド', ko: 'PATH 추가 명령', es: 'Comando para añadir al PATH', fr: 'Commande pour ajouter au PATH',
  },
  'settings.cli.reloadCommand': {
    'zh-CN': '让当前终端立即生效', en: 'Apply to the current terminal', ja: '現在のターミナルに反映', ko: '현재 터미널에 적용', es: 'Aplicar al terminal actual', fr: 'Appliquer au terminal actuel',
  },
  'settings.cli.copyCommand': {
    'zh-CN': '复制命令', en: 'Copy command', ja: 'コマンドをコピー', ko: '명령 복사', es: 'Copiar comando', fr: 'Copier la commande',
  },
  'settings.cli.loading': {
    'zh-CN': '正在检查 CLI 安装状态…', en: 'Checking CLI installation…', ja: 'CLIのインストール状態を確認中…', ko: 'CLI 설치 상태 확인 중…', es: 'Comprobando la instalación de la CLI…', fr: 'Vérification de l’installation de la CLI…',
  },
  'settings.cli.unsupported': {
    'zh-CN': '当前系统不支持本机 CLI 安装。', en: 'The current system does not support local CLI installation.', ja: '現在のシステムはローカルCLIのインストールに対応していません。', ko: '현재 시스템은 로컬 CLI 설치를 지원하지 않습니다.', es: 'El sistema actual no admite la instalación local de la CLI.', fr: 'Le système actuel ne prend pas en charge l’installation locale de la CLI.',
  },
  'settings.cli.firstLaunchTitle': {
    'zh-CN': '安装 Avenil CLI', en: 'Install the Avenil CLI', ja: 'Avenil CLIをインストール', ko: 'Avenil CLI 설치', es: 'Instalar la CLI de Avenil', fr: 'Installer la CLI Avenil',
  },
  'settings.cli.firstLaunchSubtitle': {
    'zh-CN': '首次启动设置', en: 'First-launch setup', ja: '初回起動の設定', ko: '첫 실행 설정', es: 'Configuración inicial', fr: 'Configuration au premier lancement',
  },
  'settings.cli.later': {
    'zh-CN': '稍后再说', en: 'Maybe later', ja: '後で', ko: '나중에', es: 'Más tarde', fr: 'Plus tard',
  },
  'transfer.menuAria': {
    'zh-CN': '导入和导出操作', en: 'Import and export actions', ja: 'インポートとエクスポートの操作', ko: '가져오기 및 내보내기 작업', es: 'Acciones de importación y exportación', fr: "Actions d’importation et d’exportation",
  },
  'transfer.trigger': {
    'zh-CN': '导入 / 导出', en: 'Import / Export', ja: 'インポート / エクスポート', ko: '가져오기 / 내보내기', es: 'Importar / Exportar', fr: 'Importer / Exporter',
  },
  'transfer.section': {
    'zh-CN': '配置操作', en: 'Configuration', ja: '設定操作', ko: '구성 작업', es: 'Configuración', fr: 'Configuration',
  },
  'transfer.importIde': {
    'zh-CN': '从 IDE 导入', en: 'Import from IDE', ja: 'IDEからインポート', ko: 'IDE에서 가져오기', es: 'Importar desde IDE', fr: 'Importer depuis un IDE',
  },
  'transfer.importIdeHint': {
    'zh-CN': 'VS Code / JetBrains', en: 'VS Code / JetBrains', ja: 'VS Code / JetBrains', ko: 'VS Code / JetBrains', es: 'VS Code / JetBrains', fr: 'VS Code / JetBrains',
  },
  'transfer.importConfig': {
    'zh-CN': '导入配置', en: 'Import configuration', ja: '設定をインポート', ko: '구성 가져오기', es: 'Importar configuración', fr: 'Importer la configuration',
  },
  'transfer.importConfigHint': {
    'zh-CN': '从 JSON 文件替换当前配置', en: 'Replace the current configuration from a JSON file', ja: 'JSONファイルで現在の設定を置き換えます', ko: 'JSON 파일로 현재 구성을 대체합니다', es: 'Reemplaza la configuración actual desde un archivo JSON', fr: 'Remplace la configuration actuelle depuis un fichier JSON',
  },
  'transfer.exportConfig': {
    'zh-CN': '导出配置', en: 'Export configuration', ja: '設定をエクスポート', ko: '구성 내보내기', es: 'Exportar configuración', fr: 'Exporter la configuration',
  },
  'transfer.exportConfigHint': {
    'zh-CN': '导出当前 JSON', en: 'Export the current JSON', ja: '現在のJSONをエクスポート', ko: '현재 JSON 내보내기', es: 'Exporta el JSON actual', fr: 'Exporte le JSON actuel',
  },
  'editor.addTitle': {
    'zh-CN': '添加服务', en: 'Add service', ja: 'サービスを追加', ko: '서비스 추가', es: 'Añadir servicio', fr: 'Ajouter un service',
  },
  'editor.editTitle': {
    'zh-CN': '编辑服务', en: 'Edit service', ja: 'サービスを編集', ko: '서비스 편집', es: 'Editar servicio', fr: 'Modifier le service',
  },
  'editor.subtitle': {
    'zh-CN': '配置一个由 Avenil 管理的本地前台进程', en: 'Configure a local foreground process managed by Avenil', ja: 'Avenilが管理するローカルフォアグラウンドプロセスを設定します', ko: 'Avenil이 관리할 로컬 포그라운드 프로세스를 구성합니다', es: 'Configura un proceso local en primer plano administrado por Avenil', fr: 'Configurez un processus local au premier plan géré par Avenil',
  },
  'editor.mode': {
    'zh-CN': '编辑模式', en: 'Edit mode', ja: '編集モード', ko: '편집 모드', es: 'Modo de edición', fr: 'Mode d’édition',
  },
  'editor.jsonMode': {
    'zh-CN': 'JSON', en: 'JSON', ja: 'JSON', ko: 'JSON', es: 'JSON', fr: 'JSON',
  },
  'editor.formMode': {
    'zh-CN': '表单', en: 'Form', ja: 'フォーム', ko: '양식', es: 'Formulario', fr: 'Formulaire',
  },
  'editor.jsonInvalid': {
    'zh-CN': 'JSON 格式无效，请检查服务配置对象、环境变量和日志配置。', en: 'Invalid JSON. Check the service object, environment variables, and log policy.', ja: 'JSONが無効です。サービス、環境変数、ログ設定を確認してください。', ko: 'JSON이 올바르지 않습니다. 서비스, 환경 변수 및 로그 설정을 확인하세요.', es: 'JSON no válido. Revisa el servicio, las variables de entorno y la política de registros.', fr: 'JSON invalide. Vérifiez le service, les variables d’environnement et la politique de journaux.',
  },
  'editor.serviceName': {
    'zh-CN': '服务名称', en: 'Service name', ja: 'サービス名', ko: '서비스 이름', es: 'Nombre del servicio', fr: 'Nom du service',
  },
  'editor.serviceNamePlaceholder': {
    'zh-CN': '例如：订单 API', en: 'e.g. Orders API', ja: '例：注文 API', ko: '예: 주문 API', es: 'p. ej., API de pedidos', fr: 'ex. : API de commandes',
  },
  'editor.project': {
    'zh-CN': '项目组', en: 'Project', ja: 'プロジェクト', ko: '프로젝트', es: 'Proyecto', fr: 'Projet',
  },
  'editor.workingDirectory': {
    'zh-CN': '工作目录', en: 'Working directory', ja: '作業ディレクトリ', ko: '작업 디렉터리', es: 'Directorio de trabajo', fr: 'Répertoire de travail',
  },
  'editor.workingDirectoryHint': {
    'zh-CN': '命令会在此目录下执行', en: 'The command runs from this directory', ja: 'コマンドはこのディレクトリで実行されます', ko: '명령은 이 디렉터리에서 실행됩니다', es: 'El comando se ejecutará desde este directorio', fr: 'La commande sera exécutée depuis ce répertoire',
  },
  'editor.workingDirectoryPlaceholder': {
    'zh-CN': '/Users/you/projects/service', en: '/Users/you/projects/service', ja: '/Users/you/projects/service', ko: '/Users/you/projects/service', es: '/Users/you/projects/service', fr: '/Users/you/projects/service',
  },
  'editor.startCommand': {
    'zh-CN': '启动命令', en: 'Start command', ja: '起動コマンド', ko: '시작 명령', es: 'Comando de inicio', fr: 'Commande de démarrage',
  },
  'editor.commandPlaceholder': {
    'zh-CN': 'pnpm dev / mvn spring-boot:run / python -m app', en: 'pnpm dev / mvn spring-boot:run / python -m app', ja: 'pnpm dev / mvn spring-boot:run / python -m app', ko: 'pnpm dev / mvn spring-boot:run / python -m app', es: 'pnpm dev / mvn spring-boot:run / python -m app', fr: 'pnpm dev / mvn spring-boot:run / python -m app',
  },
  'editor.port': {
    'zh-CN': '端口', en: 'Port', ja: 'ポート', ko: '포트', es: 'Puerto', fr: 'Port',
  },
  'editor.portHint': {
    'zh-CN': '启用本地 TCP 就绪检查', en: 'Enable a local TCP readiness check', ja: 'ローカルTCPの準備状態チェックを有効にします', ko: '로컬 TCP 준비 상태 검사를 사용합니다', es: 'Activa una comprobación TCP local de disponibilidad', fr: 'Active un contrôle local de disponibilité TCP',
  },
  'editor.optional': {
    'zh-CN': '可选', en: 'Optional', ja: '任意', ko: '선택 사항', es: 'Opcional', fr: 'Facultatif',
  },
  'editor.url': {
    'zh-CN': 'URL', en: 'URL', ja: 'URL', ko: 'URL', es: 'URL', fr: 'URL',
  },
  'editor.urlHint': {
    'zh-CN': '仅用于打开地址', en: 'Used only to open the address', ja: 'アドレスを開くためだけに使用します', ko: '주소를 여는 데만 사용됩니다', es: 'Solo se utiliza para abrir la dirección', fr: 'Utilisée uniquement pour ouvrir l’adresse',
  },
  'editor.envTitle': {
    'zh-CN': '环境变量', en: 'Environment variables', ja: '環境変数', ko: '환경 변수', es: 'Variables de entorno', fr: "Variables d’environnement",
  },
  'editor.envDescription': {
    'zh-CN': '启动服务时会按原值注入环境', en: 'Values are passed to the service as entered', ja: '入力した値をそのままサービスに渡します', ko: '입력한 값을 서비스에 그대로 전달합니다', es: 'Los valores se pasan al servicio tal como se introducen', fr: 'Les valeurs sont transmises au service telles qu’elles sont saisies',
  },
  'editor.addVariable': {
    'zh-CN': '添加变量', en: 'Add variable', ja: '変数を追加', ko: '변수 추가', es: 'Añadir variable', fr: 'Ajouter une variable',
  },
  'editor.keyPlaceholder': {
    'zh-CN': 'KEY', en: 'KEY', ja: 'KEY', ko: 'KEY', es: 'KEY', fr: 'KEY',
  },
  'editor.valuePlaceholder': {
    'zh-CN': '值', en: 'Value', ja: '値', ko: '값', es: 'Valor', fr: 'Valeur',
  },
  'editor.deleteVariable': {
    'zh-CN': '删除变量', en: 'Delete variable', ja: '変数を削除', ko: '변수 삭제', es: 'Eliminar variable', fr: 'Supprimer la variable',
  },
  'editor.envEmpty': {
    'zh-CN': '暂未添加环境变量', en: 'No environment variables added yet', ja: '環境変数はまだありません', ko: '아직 환경 변수가 추가되지 않았습니다', es: 'Todavía no hay variables de entorno', fr: 'Aucune variable d’environnement pour le moment',
  },
  'editor.advanced': {
    'zh-CN': '高级设置', en: 'Advanced settings', ja: '詳細設定', ko: '고급 설정', es: 'Ajustes avanzados', fr: 'Réglages avancés',
  },
  'editor.advancedDescription': {
    'zh-CN': 'Shell 与日志轮转', en: 'Shell and log rotation', ja: 'Shellとログローテーション', ko: 'Shell 및 로그 순환', es: 'Shell y rotación de registros', fr: 'Shell et rotation des journaux',
  },
  'editor.shellProgram': {
    'zh-CN': 'Shell 程序', en: 'Shell program', ja: 'Shellプログラム', ko: 'Shell 프로그램', es: 'Programa de Shell', fr: 'Programme Shell',
  },
  'editor.shellArgs': {
    'zh-CN': 'Shell 参数', en: 'Shell arguments', ja: 'Shell引数', ko: 'Shell 인수', es: 'Argumentos de Shell', fr: 'Arguments Shell',
  },
  'editor.singleFileLimit': {
    'zh-CN': '单文件上限', en: 'Per-file limit', ja: '1ファイル上限', ko: '파일당 한도', es: 'Límite por archivo', fr: 'Limite par fichier',
  },
  'editor.rotateCount': {
    'zh-CN': '轮转文件数', en: 'Rotated files', ja: 'ローテーション数', ko: '순환 파일 수', es: 'Archivos rotados', fr: 'Fichiers en rotation',
  },
  'editor.memoryLimit': {
    'zh-CN': '内存上限', en: 'Memory limit', ja: 'メモリ上限', ko: '메모리 한도', es: 'Límite de memoria', fr: 'Limite mémoire',
  },
  'editor.advancedNote': {
    'zh-CN': '日志文件会按服务隔离并按大小轮转，内存日志超限会丢弃较早内容。', en: 'Log files are isolated per service and rotated by size. Older in-memory entries are discarded when the limit is reached.', ja: 'ログファイルはサービスごとに分離され、サイズでローテーションされます。メモリ上限に達すると古い内容が破棄されます。', ko: '로그 파일은 서비스별로 분리되고 크기에 따라 순환됩니다. 메모리 한도에 도달하면 오래된 내용이 삭제됩니다.', es: 'Los archivos de registro se aíslan por servicio y rotan por tamaño. Las entradas antiguas en memoria se descartan al alcanzar el límite.', fr: 'Les journaux sont isolés par service et font l’objet d’une rotation par taille. Les anciennes entrées en mémoire sont supprimées lorsque la limite est atteinte.',
  },
  'editor.cancel': {
    'zh-CN': '取消', en: 'Cancel', ja: 'キャンセル', ko: '취소', es: 'Cancelar', fr: 'Annuler',
  },
  'editor.save': {
    'zh-CN': '保存', en: 'Save', ja: '保存', ko: '저장', es: 'Guardar', fr: 'Enregistrer',
  },
  'editor.saveService': {
    'zh-CN': '保存服务', en: 'Save service', ja: 'サービスを保存', ko: '서비스 저장', es: 'Guardar servicio', fr: 'Enregistrer le service',
  },
  'editor.saving': {
    'zh-CN': '保存中…', en: 'Saving…', ja: '保存中…', ko: '저장 중…', es: 'Guardando…', fr: 'Enregistrement…',
  },
  'groupEditor.newTitle': {
    'zh-CN': '新建项目组', en: 'Create project', ja: 'プロジェクトを作成', ko: '프로젝트 만들기', es: 'Crear proyecto', fr: 'Créer un projet',
  },
  'groupEditor.editTitle': {
    'zh-CN': '编辑项目组', en: 'Edit project', ja: 'プロジェクトを編集', ko: '프로젝트 편집', es: 'Editar proyecto', fr: 'Modifier le projet',
  },
  'groupEditor.subtitle': {
    'zh-CN': '把来自不同仓库的服务放进同一个工作区', en: 'Keep services from different repositories in one workspace', ja: '異なるリポジトリのサービスを同じワークスペースにまとめます', ko: '여러 저장소의 서비스를 하나의 워크스페이스에 모읍니다', es: 'Mantén en un mismo espacio servicios de distintos repositorios', fr: 'Regroupez les services de différents dépôts dans un même espace',
  },
  'groupEditor.name': {
    'zh-CN': '项目组名称', en: 'Project name', ja: 'プロジェクト名', ko: '프로젝트 이름', es: 'Nombre del proyecto', fr: 'Nom du projet',
  },
  'groupEditor.placeholder': {
    'zh-CN': '例如：电商本地环境', en: 'e.g. Local shop', ja: '例：ECローカル環境', ko: '예: 쇼핑몰 로컬 환경', es: 'p. ej., Tienda local', fr: 'ex. : Boutique locale',
  },
  'groupEditor.delete': {
    'zh-CN': '删除项目组', en: 'Delete project', ja: 'プロジェクトを削除', ko: '프로젝트 삭제', es: 'Eliminar proyecto', fr: 'Supprimer le projet',
  },
  'import.title': {
    'zh-CN': '导入配置', en: 'Import configuration', ja: '設定をインポート', ko: '구성 가져오기', es: 'Importar configuración', fr: 'Importer la configuration',
  },
  'import.subtitle': {
    'zh-CN': '这会用文件内容整份替换当前配置', en: 'This replaces the current configuration with the file contents', ja: 'ファイルの内容で現在の設定全体を置き換えます', ko: '파일 내용으로 현재 구성을 전체 대체합니다', es: 'Esto reemplaza la configuración actual con el contenido del archivo', fr: 'Le contenu du fichier remplacera toute la configuration actuelle',
  },
  'import.groups': {
    'zh-CN': '个项目组', en: 'projects', ja: 'プロジェクト', ko: '프로젝트', es: 'proyectos', fr: 'projets',
  },
  'import.services': {
    'zh-CN': '个服务', en: 'services', ja: 'サービス', ko: '서비스', es: 'servicios', fr: 'services',
  },
  'import.changes': {
    'zh-CN': '项服务变更', en: 'service changes', ja: 'サービス変更', ko: '서비스 변경', es: 'cambios de servicios', fr: 'modifications de services',
  },
  'import.valid': {
    'zh-CN': '文件校验通过，可以应用', en: 'File validated and ready to apply', ja: 'ファイルの検証に成功しました。適用できます', ko: '파일 검증이 완료되어 적용할 수 있습니다', es: 'Archivo validado y listo para aplicar', fr: 'Fichier validé et prêt à être appliqué',
  },
  'import.blocked': {
    'zh-CN': '配置中被修改或删除的服务正在运行，请先停止对应服务。', en: 'A service being changed or removed is running. Stop that service before replacing the configuration.', ja: '変更または削除するサービスが実行中です。そのサービスを停止してから設定を置き換えてください。', ko: '변경하거나 삭제할 서비스가 실행 중입니다. 해당 서비스를 중지한 후 구성을 대체하세요.', es: 'Un servicio que se va a cambiar o eliminar está en ejecución. Detén ese servicio antes de reemplazar la configuración.', fr: 'Un service à modifier ou supprimer est en cours d’exécution. Arrêtez ce service avant de remplacer la configuration.',
  },
  'import.note': {
    'zh-CN': '导入不会合并当前内容，应用后当前服务定义将被替换。', en: 'Import does not merge with the current data; applying it replaces the current service definitions.', ja: 'インポートは現在の内容と統合されません。適用すると現在のサービス定義が置き換えられます。', ko: '가져오기는 현재 내용과 병합되지 않으며, 적용하면 현재 서비스 정의가 대체됩니다.', es: 'La importación no combina los datos actuales; al aplicarla se reemplazan las definiciones de servicios.', fr: 'L’importation ne fusionne pas les données actuelles ; son application remplace les définitions de services.',
  },
  'import.applying': {
    'zh-CN': '替换中…', en: 'Replacing…', ja: '置き換え中…', ko: '대체 중…', es: 'Reemplazando…', fr: 'Remplacement…',
  },
  'import.apply': {
    'zh-CN': '应用替换', en: 'Apply replacement', ja: '置き換えを適用', ko: '대체 적용', es: 'Aplicar reemplazo', fr: 'Appliquer le remplacement',
  },
  'ide.title': {
    'zh-CN': '从 IDE 导入', en: 'Import from IDE', ja: 'IDEからインポート', ko: 'IDE에서 가져오기', es: 'Importar desde IDE', fr: 'Importer depuis un IDE',
  },
  'ide.subtitle': {
    'zh-CN': '读取普通运行配置，追加到 Avenil 项目组', en: 'Read regular run configurations and add them to an Avenil project', ja: '通常の実行設定を読み込み、Avenilプロジェクトに追加します', ko: '일반 실행 구성을 읽어 Avenil 프로젝트에 추가합니다', es: 'Lee configuraciones de ejecución normales y añádelas a un proyecto de Avenil', fr: 'Lisez les configurations d’exécution classiques et ajoutez-les à un projet Avenil',
  },
  'ide.close': {
    'zh-CN': '关闭导入', en: 'Close import', ja: 'インポートを閉じる', ko: '가져오기 닫기', es: 'Cerrar importación', fr: "Fermer l’importation",
  },
  'ide.notice': {
    'zh-CN': '选择项目根目录后，Avenil 会自动查找 VS Code 和 JetBrains 的运行配置；仅导入普通运行配置，不提供调试。', en: 'After you choose a project root, Avenil finds VS Code and JetBrains run configurations automatically. Only regular run configurations are imported; debugging is not supported.', ja: 'プロジェクトのルートを選択すると、AvenilはVS CodeとJetBrainsの実行設定を自動検索します。通常の実行設定のみをインポートし、デバッグには対応しません。', ko: '프로젝트 루트를 선택하면 Avenil이 VS Code 및 JetBrains 실행 구성을 자동으로 찾습니다. 일반 실행 구성만 가져오며 디버깅은 지원하지 않습니다.', es: 'Al elegir la raíz del proyecto, Avenil busca automáticamente configuraciones de ejecución de VS Code y JetBrains. Solo se importan configuraciones normales; la depuración no está disponible.', fr: 'Après avoir choisi la racine du projet, Avenil recherche automatiquement les configurations d’exécution VS Code et JetBrains. Seules les configurations classiques sont importées ; le débogage n’est pas pris en charge.',
  },
  'ide.projectRoot': {
    'zh-CN': '项目根目录', en: 'Project root', ja: 'プロジェクトルート', ko: '프로젝트 루트', es: 'Raíz del proyecto', fr: 'Racine du projet',
  },
  'ide.projectRootHint': {
    'zh-CN': 'Avenil 将从目录下的 .vscode、.idea 或 .run 中查找配置', en: 'Avenil looks for configurations in .vscode, .idea, or .run under this directory', ja: 'このディレクトリの.vscode、.idea、.runから設定を検索します', ko: '이 디렉터리 아래의 .vscode, .idea 또는 .run에서 구성을 찾습니다', es: 'Avenil buscará configuraciones en .vscode, .idea o .run dentro de este directorio', fr: 'Avenil recherche les configurations dans .vscode, .idea ou .run sous ce répertoire',
  },
  'ide.projectRootPlaceholder': {
    'zh-CN': '/Users/you/project', en: '/Users/you/project', ja: '/Users/you/project', ko: '/Users/you/project', es: '/Users/you/project', fr: '/Users/you/project',
  },
  'ide.chooseDirectory': {
    'zh-CN': '选择目录', en: 'Choose directory', ja: 'ディレクトリを選択', ko: '디렉터리 선택', es: 'Elegir directorio', fr: 'Choisir un répertoire',
  },
  'ide.chooseRoot': {
    'zh-CN': '请选择项目根目录', en: 'Choose a project root', ja: 'プロジェクトルートを選択してください', ko: '프로젝트 루트를 선택하세요', es: 'Elige la raíz del proyecto', fr: 'Choisissez la racine du projet',
  },
  'ide.absolutePath': {
    'zh-CN': '请输入以 / 开头的绝对路径', en: 'Enter an absolute path starting with /', ja: '/で始まる絶対パスを入力してください', ko: '/로 시작하는 절대 경로를 입력하세요', es: 'Introduce una ruta absoluta que empiece por /', fr: 'Saisissez un chemin absolu commençant par /',
  },
  'ide.previewReady': {
    'zh-CN': '已找到配置，可继续确认导入', en: 'Configurations found; review the import', ja: '設定が見つかりました。インポートを確認できます', ko: '구성을 찾았습니다. 가져오기를 검토하세요', es: 'Configuraciones encontradas; revisa la importación', fr: 'Configurations trouvées ; vérifiez l’importation',
  },
  'ide.prepareSearch': {
    'zh-CN': '准备自动查找 IDE 配置', en: 'Ready to search for IDE configurations', ja: 'IDE設定を自動検索する準備ができました', ko: 'IDE 구성을 자동으로 검색할 준비가 되었습니다', es: 'Listo para buscar configuraciones de IDE', fr: 'Prêt à rechercher les configurations IDE',
  },
  'ide.findConfig': {
    'zh-CN': '查找配置', en: 'Find configurations', ja: '設定を検索', ko: '구성 찾기', es: 'Buscar configuraciones', fr: 'Rechercher les configurations',
  },
  'ide.discoveredSources': {
    'zh-CN': '已发现 {count} 个 IDE 配置文件', en: 'Found {count} IDE configuration files', ja: 'IDE設定ファイルが{count}個見つかりました', ko: 'IDE 구성 파일 {count}개를 찾았습니다', es: 'Se encontraron {count} archivos de configuración de IDE', fr: '{count} fichiers de configuration IDE trouvés',
  },
  'ide.demoData': {
    'zh-CN': '浏览器演示数据', en: 'Browser demo data', ja: 'ブラウザのデモデータ', ko: '브라우저 데모 데이터', es: 'Datos de demostración del navegador', fr: 'Données de démonstration du navigateur',
  },
  'ide.localConfig': {
    'zh-CN': '本机配置', en: 'Local configuration', ja: 'ローカル設定', ko: '로컬 구성', es: 'Configuración local', fr: 'Configuration locale',
  },
  'ide.targetProject': {
    'zh-CN': '目标项目组', en: 'Target project', ja: '対象プロジェクト', ko: '대상 프로젝트', es: 'Proyecto de destino', fr: 'Projet cible',
  },
  'ide.status.ready': {
    'zh-CN': '可导入', en: 'Ready', ja: 'インポート可', ko: '가져올 수 있음', es: 'Listo', fr: 'Prêt',
  },
  'ide.status.needsInput': {
    'zh-CN': '需要补充', en: 'Needs input', ja: '入力が必要', ko: '입력 필요', es: 'Requiere datos', fr: 'Saisie requise',
  },
  'ide.status.unsupported': {
    'zh-CN': '不支持', en: 'Unsupported', ja: '未対応', ko: '지원되지 않음', es: 'No compatible', fr: 'Non pris en charge',
  },
  'ide.candidateFallback': {
    'zh-CN': '无法转换为普通运行服务', en: 'Cannot be converted to a regular run service', ja: '通常の実行サービスに変換できません', ko: '일반 실행 서비스로 변환할 수 없습니다', es: 'No se puede convertir en un servicio de ejecución normal', fr: 'Impossible de convertir en service d’exécution classique',
  },
  'ide.env': {
    'zh-CN': '环境变量：{keys}', en: 'Environment variables: {keys}', ja: '環境変数：{keys}', ko: '환경 변수: {keys}', es: 'Variables de entorno: {keys}', fr: 'Variables d’environnement : {keys}',
  },
  'ide.missing': {
    'zh-CN': '缺少：{items}', en: 'Missing: {items}', ja: '不足：{items}', ko: '누락: {items}', es: 'Falta: {items}', fr: 'Manquant : {items}',
  },
  'ide.selectionCount': {
    'zh-CN': '{selected}/{total} 个可导入配置', en: '{selected}/{total} importable configurations', ja: 'インポート可能な設定 {selected}/{total}件', ko: '가져올 수 있는 구성 {selected}/{total}개', es: '{selected}/{total} configuraciones importables', fr: '{selected}/{total} configurations importables',
  },
  'ide.noPreview': {
    'zh-CN': '尚未读取预览', en: 'No preview loaded', ja: 'プレビュー未読み込み', ko: '미리보기가 아직 로드되지 않음', es: 'No se ha cargado ninguna vista previa', fr: 'Aucun aperçu chargé',
  },
  'ide.addToAvenil': {
    'zh-CN': '添加到 Avenil', en: 'Add to Avenil', ja: 'Avenilに追加', ko: 'Avenil에 추가', es: 'Añadir a Avenil', fr: 'Ajouter à Avenil',
  },
  'empty.noMatchTitle': {
    'zh-CN': '没有匹配的服务', en: 'No matching services', ja: '一致するサービスがありません', ko: '일치하는 서비스가 없습니다', es: 'No hay servicios coincidentes', fr: 'Aucun service correspondant',
  },
  'empty.noMatchDescription': {
    'zh-CN': '切换服务分类或清除当前筛选条件。', en: 'Switch the service filter or clear the current filters.', ja: 'サービスの分類を切り替えるか、現在のフィルターをクリアしてください。', ko: '서비스 필터를 바꾸거나 현재 필터를 지우세요.', es: 'Cambia el filtro de servicios o borra los filtros actuales.', fr: 'Changez le filtre de services ou effacez les filtres actuels.',
  },
  'empty.startTitle': {
    'zh-CN': '开始管理本地服务', en: 'Start managing local services', ja: 'ローカルサービスの管理を始める', ko: '로컬 서비스 관리 시작', es: 'Empieza a gestionar servicios locales', fr: 'Commencez à gérer vos services locaux',
  },
  'empty.startDescription': {
    'zh-CN': '添加 Java、Node、Python 或前端项目，让多个服务在一个窗口里井然有序。', en: 'Add Java, Node, Python, or frontend projects and keep multiple services organized in one window.', ja: 'Java、Node、Python、フロントエンドのプロジェクトを追加し、複数のサービスを1つのウィンドウで整理しましょう。', ko: 'Java, Node, Python 또는 프런트엔드 프로젝트를 추가하고 여러 서비스를 한 창에서 정리하세요.', es: 'Añade proyectos de Java, Node, Python o frontend y organiza varios servicios en una sola ventana.', fr: 'Ajoutez des projets Java, Node, Python ou frontend et organisez plusieurs services dans une seule fenêtre.',
  },
  'empty.clearFilters': {
    'zh-CN': '清除筛选', en: 'Clear filters', ja: 'フィルターをクリア', ko: '필터 지우기', es: 'Borrar filtros', fr: 'Effacer les filtres',
  },
  'empty.addFirst': {
    'zh-CN': '添加第一个服务', en: 'Add your first service', ja: '最初のサービスを追加', ko: '첫 서비스 추가', es: 'Añadir el primer servicio', fr: 'Ajouter votre premier service',
  },
  'desktop.title': {
    'zh-CN': 'Avenil 需要桌面运行时', en: 'Avenil needs the desktop runtime', ja: 'Avenilにはデスクトップランタイムが必要です', ko: 'Avenil에는 데스크톱 런타임이 필요합니다', es: 'Avenil necesita el runtime de escritorio', fr: 'Avenil a besoin du runtime de bureau',
  },
  'desktop.description': {
    'zh-CN': '当前页面运行在普通浏览器中。请打开 Tauri 桌面应用管理本机进程；浏览器预览仅在地址后添加 ?preview=1 时启用演示数据。', en: 'This page is running in a regular browser. Open the Tauri desktop app to manage local processes; browser demo data is available only when you add ?preview=1 to the address.', ja: 'このページは通常のブラウザで実行されています。ローカルプロセスを管理するにはTauriデスクトップアプリを開いてください。ブラウザのデモデータはURLに?preview=1を追加した場合のみ利用できます。', ko: '현재 페이지는 일반 브라우저에서 실행 중입니다. 로컬 프로세스를 관리하려면 Tauri 데스크톱 앱을 여세요. 브라우저 데모 데이터는 주소에 ?preview=1을 추가한 경우에만 사용할 수 있습니다.', es: 'Esta página se está ejecutando en un navegador normal. Abre la aplicación de escritorio Tauri para gestionar procesos locales; los datos de demostración solo están disponibles al añadir ?preview=1 a la dirección.', fr: 'Cette page s’exécute dans un navigateur classique. Ouvrez l’application de bureau Tauri pour gérer les processus locaux ; les données de démonstration du navigateur sont disponibles uniquement en ajoutant ?preview=1 à l’adresse.',
  },
  'desktop.note': {
    'zh-CN': '普通浏览器不会自动切换到模拟模式，也不会访问本机服务。', en: 'A regular browser does not switch to mock mode automatically or access local services.', ja: '通常のブラウザは自動でモックモードに切り替わらず、ローカルサービスにもアクセスしません。', ko: '일반 브라우저는 자동으로 모의 모드로 전환하거나 로컬 서비스에 접근하지 않습니다.', es: 'Un navegador normal no cambia automáticamente al modo simulado ni accede a los servicios locales.', fr: 'Un navigateur classique ne passe pas automatiquement en mode simulé et n’accède pas aux services locaux.',
  },
  'toast.shutdownStarting': {
    'zh-CN': '正在停止 Avenil 托管服务…', en: 'Stopping services managed by Avenil…', ja: 'Avenilの管理サービスを停止中…', ko: 'Avenil이 관리하는 서비스를 중지하는 중…', es: 'Deteniendo los servicios gestionados por Avenil…', fr: 'Arrêt des services gérés par Avenil…',
  },
  'toast.shutdownForced': {
    'zh-CN': '退出时有服务未能停止，Avenil 仍保持运行', en: 'Some services did not stop on exit; Avenil is still running', ja: '終了時に停止できないサービスがありました。Avenilは引き続き実行されています', ko: '종료 시 중지되지 않은 서비스가 있어 Avenil은 계속 실행 중입니다', es: 'Algunos servicios no se detuvieron al salir; Avenil sigue en ejecución', fr: 'Certains services ne se sont pas arrêtés à la fermeture ; Avenil reste ouvert',
  },
  'toast.ideBusy': {
    'zh-CN': '正在处理 IDE 导入，请稍候。', en: 'The IDE import is being processed. Please wait.', ja: 'IDEのインポートを処理中です。しばらくお待ちください。', ko: 'IDE 가져오기를 처리 중입니다. 잠시 기다려 주세요.', es: 'Se está procesando la importación del IDE. Espera.', fr: 'Importation IDE en cours. Veuillez patienter.',
  },
  'toast.cliInstalled': {
    'zh-CN': 'CLI 已安装到 ~/.local/bin', en: 'CLI installed in ~/.local/bin', ja: 'CLIを~/.local/binにインストールしました', ko: 'CLI를 ~/.local/bin에 설치했습니다', es: 'CLI instalada en ~/.local/bin', fr: 'CLI installée dans ~/.local/bin',
  },
  'toast.cliCopyFailed': {
    'zh-CN': '复制命令失败，请直接选择并复制下方文本', en: 'Could not copy the command; select and copy the text below manually', ja: 'コマンドをコピーできませんでした。下のテキストを選択してコピーしてください', ko: '명령을 복사하지 못했습니다. 아래 텍스트를 직접 선택해 복사하세요', es: 'No se pudo copiar el comando; selecciónalo y cópialo manualmente', fr: 'Impossible de copier la commande ; sélectionnez et copiez le texte manuellement',
  },
  'toast.shutdownBusy': {
    'zh-CN': 'Avenil 正在停止托管服务，完成后才能添加导入配置。', en: 'Avenil is stopping managed services. You can add imported configuration when it finishes.', ja: 'Avenilが管理サービスを停止中です。完了後にインポート設定を追加できます。', ko: 'Avenil이 관리 서비스를 중지하고 있습니다. 완료되면 가져온 구성을 추가할 수 있습니다.', es: 'Avenil está deteniendo los servicios administrados. Podrás añadir configuraciones importadas cuando termine.', fr: 'Avenil arrête les services gérés. Vous pourrez ajouter la configuration importée une fois terminé.',
  },
  'toast.actionBusy': {
    'zh-CN': '当前有服务操作进行中，完成后才能添加导入配置。', en: 'A service operation is in progress. You can add imported configuration when it finishes.', ja: 'サービス操作を実行中です。完了後にインポート設定を追加できます。', ko: '서비스 작업이 진행 중입니다. 완료되면 가져온 구성을 추가할 수 있습니다.', es: 'Hay una operación de servicio en curso. Podrás añadir configuraciones importadas cuando termine.', fr: 'Une opération de service est en cours. Vous pourrez ajouter la configuration importée une fois terminée.',
  },
  'toast.runningBusy': {
    'zh-CN': '当前有服务正在运行或切换中，请停止全部服务后再添加导入配置。', en: 'Some services are running or changing state. Stop all services before adding imported configuration.', ja: '実行中または状態が変化中のサービスがあります。すべて停止してからインポート設定を追加してください。', ko: '실행 중이거나 상태가 변경 중인 서비스가 있습니다. 모두 중지한 후 가져온 구성을 추가하세요.', es: 'Hay servicios en ejecución o cambiando de estado. Detén todos los servicios antes de añadir la configuración importada.', fr: 'Certains services sont en cours d’exécution ou changent d’état. Arrêtez-les tous avant d’ajouter la configuration importée.',
  },
  'toast.startRequested': {
    'zh-CN': '服务启动请求已发送', en: 'Service start request sent', ja: 'サービスの起動リクエストを送信しました', ko: '서비스 시작 요청을 보냈습니다', es: 'Solicitud de inicio del servicio enviada', fr: 'Demande de démarrage du service envoyée',
  },
  'toast.stopped': {
    'zh-CN': '服务已停止', en: 'Service stopped', ja: 'サービスを停止しました', ko: '서비스가 중지되었습니다', es: 'Servicio detenido', fr: 'Service arrêté',
  },
  'toast.stopRequested': {
    'zh-CN': '服务停止请求已发送', en: 'Service stop request sent', ja: 'サービスの停止リクエストを送信しました', ko: '서비스 중지 요청을 보냈습니다', es: 'Solicitud de detención del servicio enviada', fr: 'Demande d’arrêt du service envoyée',
  },
  'toast.restartRequested': {
    'zh-CN': '服务重启请求已发送', en: 'Service restart request sent', ja: 'サービスの再起動リクエストを送信しました', ko: '서비스 다시 시작 요청을 보냈습니다', es: 'Solicitud de reinicio del servicio enviada', fr: 'Demande de redémarrage du service envoyée',
  },
  'toast.noServices': {
    'zh-CN': '这个项目组还没有服务', en: 'This project has no services yet', ja: 'このプロジェクトにはまだサービスがありません', ko: '이 프로젝트에는 아직 서비스가 없습니다', es: 'Este proyecto aún no tiene servicios', fr: 'Ce projet ne contient encore aucun service',
  },
  'toast.batchFailed': {
    'zh-CN': '{success} 个服务已处理，{failed} 个失败', en: '{success} services processed, {failed} failed', ja: '{success}件を処理しました。{failed}件が失敗しました', ko: '{success}개 서비스 처리, {failed}개 실패', es: '{success} servicios procesados, {failed} fallidos', fr: '{success} services traités, {failed} échec(s)',
  },
  'toast.batchAction': {
    'zh-CN': '已对 {count} 个服务执行{action}', en: '{action} applied to {count} services', ja: '{count}件のサービスに{action}を実行しました', ko: '{count}개 서비스에 {action} 적용', es: '{action} aplicado a {count} servicios', fr: '{action} appliqué à {count} services',
  },
  'toast.batchStart': {
    'zh-CN': '启动', en: 'start', ja: '起動', ko: '시작', es: 'inicio', fr: 'démarrage',
  },
  'toast.batchStop': {
    'zh-CN': '停止', en: 'stop', ja: '停止', ko: '중지', es: 'detención', fr: 'arrêt',
  },
  'toast.batchRestart': {
    'zh-CN': '重启', en: 'restart', ja: '再起動', ko: '다시 시작', es: 'reinicio', fr: 'redémarrage',
  },
  'toast.serviceFields': {
    'zh-CN': '请填写服务名称、工作目录和启动命令', en: 'Enter a service name, working directory, and start command', ja: 'サービス名、作業ディレクトリ、起動コマンドを入力してください', ko: '서비스 이름, 작업 디렉터리 및 시작 명령을 입력하세요', es: 'Introduce el nombre del servicio, el directorio de trabajo y el comando de inicio', fr: 'Renseignez le nom du service, le répertoire de travail et la commande de démarrage',
  },
  'toast.portInvalid': {
    'zh-CN': '端口必须是 1–65535 的整数', en: 'Port must be an integer from 1 to 65535', ja: 'ポートは1〜65535の整数で指定してください', ko: '포트는 1~65535 사이의 정수여야 합니다', es: 'El puerto debe ser un entero entre 1 y 65535', fr: 'Le port doit être un entier compris entre 1 et 65535',
  },
  'toast.envInvalid': {
    'zh-CN': '环境变量键名不能为空且不能重复', en: 'Environment variable keys cannot be empty or duplicated', ja: '環境変数のキーは空欄にできず、重複もできません', ko: '환경 변수 키는 비어 있거나 중복될 수 없습니다', es: 'Las claves de las variables de entorno no pueden estar vacías ni repetirse', fr: 'Les clés des variables d’environnement ne peuvent être vides ou dupliquées',
  },
  'toast.serviceAdded': {
    'zh-CN': '服务已添加', en: 'Service added', ja: 'サービスを追加しました', ko: '서비스가 추가되었습니다', es: 'Servicio añadido', fr: 'Service ajouté',
  },
  'toast.serviceUpdated': {
    'zh-CN': '服务配置已更新', en: 'Service configuration updated', ja: 'サービス設定を更新しました', ko: '서비스 구성이 업데이트되었습니다', es: 'Configuración del servicio actualizada', fr: 'Configuration du service mise à jour',
  },
  'toast.stopBeforeDelete': {
    'zh-CN': '请先停止服务，再删除配置', en: 'Stop the service before deleting its configuration', ja: '設定を削除する前にサービスを停止してください', ko: '구성을 삭제하기 전에 서비스를 중지하세요', es: 'Detén el servicio antes de eliminar su configuración', fr: 'Arrêtez le service avant de supprimer sa configuration',
  },
  'confirm.quit': {
    'zh-CN': '退出 Avenil？\n退出会自动停止所有仍在运行的托管服务。', en: 'Quit Avenil?\nAll managed services that are still running will be stopped automatically.', ja: 'Avenilを終了しますか？\n実行中の管理対象サービスはすべて自動的に停止します。', ko: 'Avenil을 종료할까요?\n실행 중인 관리 서비스가 모두 자동으로 중지됩니다.', es: '¿Salir de Avenil?\nTodos los servicios gestionados que sigan ejecutándose se detendrán automáticamente.', fr: 'Quitter Avenil ?\nTous les services gérés encore en cours seront arrêtés automatiquement.',
  },
  'confirm.deleteService': {
    'zh-CN': '删除“{name}”的 Avenil 配置？不会删除项目文件。', en: 'Delete the Avenil configuration for “{name}”? Project files will not be deleted.', ja: '「{name}」のAvenil設定を削除しますか？プロジェクトファイルは削除されません。', ko: '“{name}”의 Avenil 구성을 삭제할까요? 프로젝트 파일은 삭제되지 않습니다.', es: '¿Eliminar la configuración de Avenil de “{name}”? Los archivos del proyecto no se eliminarán.', fr: 'Supprimer la configuration Avenil de « {name} » ? Les fichiers du projet ne seront pas supprimés.',
  },
  'toast.serviceDeleted': {
    'zh-CN': '服务配置已删除', en: 'Service configuration deleted', ja: 'サービス設定を削除しました', ko: '서비스 구성이 삭제되었습니다', es: 'Configuración del servicio eliminada', fr: 'Configuration du service supprimée',
  },
  'toast.groupNameRequired': {
    'zh-CN': '请输入项目组名称', en: 'Enter a project name', ja: 'プロジェクト名を入力してください', ko: '프로젝트 이름을 입력하세요', es: 'Introduce un nombre de proyecto', fr: 'Saisissez un nom de projet',
  },
  'toast.groupUpdated': {
    'zh-CN': '项目组已更新', en: 'Project updated', ja: 'プロジェクトを更新しました', ko: '프로젝트가 업데이트되었습니다', es: 'Proyecto actualizado', fr: 'Projet mis à jour',
  },
  'toast.groupCreated': {
    'zh-CN': '项目组已创建', en: 'Project created', ja: 'プロジェクトを作成しました', ko: '프로젝트가 생성되었습니다', es: 'Proyecto creado', fr: 'Projet créé',
  },
  'toast.stopGroupFirst': {
    'zh-CN': '请先停止项目组内的服务', en: 'Stop the services in this project first', ja: '先にこのプロジェクトのサービスを停止してください', ko: '먼저 이 프로젝트의 서비스를 중지하세요', es: 'Detén primero los servicios de este proyecto', fr: 'Arrêtez d’abord les services de ce projet',
  },
  'toast.groupNotEmpty': {
    'zh-CN': '项目组仍有服务，请先将服务移出或删除', en: 'This project still has services. Move or delete them first', ja: 'このプロジェクトにはまだサービスがあります。先に移動または削除してください', ko: '이 프로젝트에 아직 서비스가 있습니다. 먼저 이동하거나 삭제하세요', es: 'Este proyecto todavía tiene servicios. Muévelos o elimínalos primero', fr: 'Ce projet contient encore des services. Déplacez-les ou supprimez-les d’abord',
  },
  'toast.groupDeleted': {
    'zh-CN': '项目组已删除', en: 'Project deleted', ja: 'プロジェクトを削除しました', ko: '프로젝트가 삭제되었습니다', es: 'Proyecto eliminado', fr: 'Projet supprimé',
  },
  'toast.exported': {
    'zh-CN': '配置已导出。', en: 'Configuration exported.', ja: '設定をエクスポートしました。', ko: '구성을 내보냈습니다.', es: 'Se exportó la configuración.', fr: 'Configuration exportée.',
  },
  'toast.configReplaced': {
    'zh-CN': '配置已整份替换', en: 'Configuration replaced', ja: '設定を置き換えました', ko: '구성이 대체되었습니다', es: 'Configuración reemplazada', fr: 'Configuration remplacée',
  },
  'toast.ideImported': {
    'zh-CN': '已添加 {count} 个服务到项目组“{group}”', en: 'Added {count} services to the “{group}” project', ja: '「{group}」プロジェクトに{count}件のサービスを追加しました', ko: '“{group}” 프로젝트에 {count}개 서비스를 추가했습니다', es: 'Se añadieron {count} servicios al proyecto “{group}”', fr: '{count} services ajoutés au projet « {group} »',
  },
  'error.operationFailed': {
    'zh-CN': '操作失败，请稍后重试', en: 'Operation failed. Please try again later', ja: '操作に失敗しました。後でもう一度お試しください', ko: '작업에 실패했습니다. 나중에 다시 시도하세요', es: 'La operación falló. Inténtalo de nuevo más tarde', fr: 'Échec de l’opération. Veuillez réessayer plus tard',
  },
  'error.nativeTheme': {
    'zh-CN': '无法同步原生窗口主题：{reason}', en: 'Could not sync the native window theme: {reason}', ja: 'ネイティブウィンドウのテーマを同期できません：{reason}', ko: '네이티브 창 테마를 동기화할 수 없습니다: {reason}', es: 'No se pudo sincronizar el tema de la ventana nativa: {reason}', fr: 'Impossible de synchroniser le thème de la fenêtre native : {reason}',
  },
  'error.themeNotSaved': {
    'zh-CN': '主题已切换，但本机无法保存偏好；下次启动将跟随系统', en: 'Theme changed, but the preference could not be saved locally; the next launch will follow the system', ja: 'テーマを変更しましたが、設定をローカルに保存できません。次回起動時はシステムに従います', ko: '테마를 변경했지만 기본 설정을 로컬에 저장할 수 없습니다. 다음 실행 시 시스템 설정을 따릅니다', es: 'El tema cambió, pero no se pudo guardar la preferencia localmente; el próximo inicio seguirá el sistema', fr: 'Thème modifié, mais la préférence n’a pas pu être enregistrée localement ; le prochain lancement suivra le système',
  },
} as const;

export type MessageKey = keyof typeof messageTable;
const messages: Record<MessageKey, LocaleMessage> = messageTable;

const LOCALE_BY_LANGUAGE: Record<AppLanguage, string> = {
  'zh-CN': 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  es: 'es-ES',
  fr: 'fr-FR',
};

export const LANGUAGE_OPTIONS = [
  { value: 'system', labelKey: 'settings.language.system' },
  { value: 'zh-CN', labelKey: 'settings.language.zh-CN' },
  { value: 'en', labelKey: 'settings.language.en' },
  { value: 'ja', labelKey: 'settings.language.ja' },
  { value: 'ko', labelKey: 'settings.language.ko' },
  { value: 'es', labelKey: 'settings.language.es' },
  { value: 'fr', labelKey: 'settings.language.fr' },
] as const satisfies ReadonlyArray<{ value: LanguagePreference; labelKey: MessageKey }>;

function isLanguagePreference(value: string | null): value is LanguagePreference {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

function readLanguagePreference(): LanguagePreference {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemLanguage(): AppLanguage {
  const locale = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase();
  if (locale.startsWith('zh')) return 'zh-CN';
  if (locale.startsWith('ja')) return 'ja';
  if (locale.startsWith('ko')) return 'ko';
  if (locale.startsWith('es')) return 'es';
  if (locale.startsWith('fr')) return 'fr';
  return 'en';
}

function resolveLanguage(preference: LanguagePreference): AppLanguage {
  return preference === 'system' ? systemLanguage() : preference;
}

type TranslateValues = Record<string, string | number>;
export type Translator = (key: MessageKey, values?: TranslateValues) => string;

function interpolate(message: string, values?: TranslateValues) {
  if (!values) return message;
  return message.replace(/\{\s*(\w+)\s*\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key]));
}

type I18nContextValue = {
  language: LanguagePreference;
  resolvedLanguage: AppLanguage;
  locale: string;
  t: Translator;
  changeLanguage: (language: LanguagePreference) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<LanguagePreference>(readLanguagePreference);
  const resolvedLanguage = resolveLanguage(language);
  const locale = LOCALE_BY_LANGUAGE[resolvedLanguage];

  const t = useCallback<Translator>((key, values) => interpolate(messages[key][resolvedLanguage], values), [resolvedLanguage]);
  const changeLanguage = useCallback((nextLanguage: LanguagePreference) => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // The UI can still switch for this session when storage is unavailable.
    }
    setLanguage(nextLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('document.title');
  }, [locale, t]);

  const value = useMemo(() => ({ language, resolvedLanguage, locale, t, changeLanguage }), [changeLanguage, language, locale, resolvedLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
