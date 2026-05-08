/**
 * OneDrive 同期ライブラリ
 *
 * コアの同期処理を提供するモジュール。
 * エントリポイント (sync_cli.ts) から呼び出される。
 */

import * as path from 'path';

// ---------------------------------------------------------------------------
// @joplin/lib のモジュールを require で読み込む（CommonJS）
// ---------------------------------------------------------------------------

const Logger = require('@joplin/lib/Logger').default;
const { TargetType } = require('@joplin/lib/Logger');
const Setting = require('@joplin/lib/models/Setting').default;
const JoplinDatabase = require('@joplin/lib/JoplinDatabase').default;
const { DatabaseDriverNode } = require('@joplin/lib/database-driver-node.js');
const BaseModel = require('@joplin/lib/BaseModel').default;
const BaseItem = require('@joplin/lib/models/BaseItem').default;
const Folder = require('@joplin/lib/models/Folder').default;
const Note = require('@joplin/lib/models/Note').default;
const Resource = require('@joplin/lib/models/Resource').default;
const Tag = require('@joplin/lib/models/Tag').default;
const NoteTag = require('@joplin/lib/models/NoteTag').default;
const MasterKey = require('@joplin/lib/models/MasterKey').default;
const Revision = require('@joplin/lib/models/Revision').default;
const EncryptionService = require('@joplin/lib/services/EncryptionService').default;
const DecryptionWorker = require('@joplin/lib/services/DecryptionWorker').default;
const RevisionService = require('@joplin/lib/services/RevisionService').default;
const { FileApiDriverLocal } = require('@joplin/lib/file-api-driver-local.js');
const FsDriverNode = require('@joplin/lib/fs-driver-node').default;
const { shimInit } = require('@joplin/lib/shim-init-node.js');
const shim = require('@joplin/lib/shim').default;
const SyncTargetRegistry = require('@joplin/lib/SyncTargetRegistry.js');
const SyncTargetOneDrive = require('@joplin/lib/SyncTargetOneDrive').default;
const SyncTargetDropbox = require('@joplin/lib/SyncTargetDropbox');
const SyncTargetFilesystem = require('@joplin/lib/SyncTargetFilesystem');
const SyncTargetNextcloud = require('@joplin/lib/SyncTargetNextcloud');
const SyncTargetWebDAV = require('@joplin/lib/SyncTargetWebDAV');
const SyncTargetAmazonS3 = require('@joplin/lib/SyncTargetAmazonS3');
const SyncTargetJoplinServer = require('@joplin/lib/SyncTargetJoplinServer').default;
const { reg } = require('@joplin/lib/registry.js');
const KeychainService = require('@joplin/lib/services/keychain/KeychainService').default;
const KeychainServiceDriver =
  require('@joplin/lib/services/keychain/KeychainServiceDriver.node').default;
const KvStore = require('@joplin/lib/services/KvStore').default;
const ResourceFetcher = require('@joplin/lib/services/ResourceFetcher').default;
const uuid = require('@joplin/lib/uuid').default;
const fs = require('fs-extra');

// ---------------------------------------------------------------------------
// コア同期処理
// ---------------------------------------------------------------------------

export interface SyncStats {
  fetchingTotal?: number;
  fetchingProcessed?: number;
  createLocal?: number;
  updateLocal?: number;
  deleteLocal?: number;
  createRemote?: number;
  updateRemote?: number;
  deleteRemote?: number;
  noteConflict?: number;
  totalFolders?: number;
  totalNotes?: number;
  totalResources?: number;
}

function reportToStats(
  report: Record<string, unknown>,
  totalFolders: number,
  totalNotes: number,
  totalResources: number
): SyncStats {
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    fetchingTotal: num(report['fetchingTotal']),
    fetchingProcessed: num(report['fetchingProcessed']),
    createLocal: num(report['createLocal']),
    updateLocal: num(report['updateLocal']),
    deleteLocal: num(report['deleteLocal']),
    createRemote: num(report['createRemote']),
    updateRemote: num(report['updateRemote']),
    deleteRemote: num(report['deleteRemote']),
    noteConflict: num(report['noteConflict']),
    totalFolders,
    totalNotes,
    totalResources,
  };
}

/**
 * 指定プロファイルディレクトリを使って OneDrive 同期を実行する。
 *
 * @param profileDir Joplin プロファイルの絶対パス（例: ~/.config/joplin-desktop）
 */
export async function runSync(profileDir: string): Promise<SyncStats> {
  // MCP stdio モードでは stdout が JSON-RPC プロトコル専用のため、
  // console.log を console.error にリダイレクトして stderr へ出力する。
  console.log = console.error;

  // --- 1. FsDriver のセットアップ（shimInit より前に必要）---
  const fsDriver = new FsDriverNode();
  Logger.fsDriver_ = fsDriver;
  Resource.fsDriver_ = fsDriver;
  EncryptionService.fsDriver_ = fsDriver;
  FileApiDriverLocal.fsDriver_ = fsDriver;

  // --- 2. BaseItem サブクラスの登録 ---
  BaseItem.loadClass('Note', Note);
  BaseItem.loadClass('Folder', Folder);
  BaseItem.loadClass('Resource', Resource);
  BaseItem.loadClass('Tag', Tag);
  BaseItem.loadClass('NoteTag', NoteTag);
  BaseItem.loadClass('MasterKey', MasterKey);
  BaseItem.loadClass('Revision', Revision);

  // --- 3. Setting 定数のセット ---
  // settings.json があれば先読みして env 等の定数も上書き可能にする
  const settingsJsonPath = path.join(profileDir, 'settings.json');
  let earlySettingsJson: Record<string, unknown> = {};
  if (fs.existsSync(settingsJsonPath)) {
    try {
      earlySettingsJson = fs.readJsonSync(settingsJsonPath);
    } catch (_) {
      /* ignore */
    }
  }

  // 後で全モジュールインスタンスへ伝播するためマップとして保持する
  const settingConstants: Record<string, string> = {
    appId: 'net.cozic.joplin-desktop',
    appType: 'cli',
    // env: typeof earlySettingsJson['env'] === 'string' ? earlySettingsJson['env'] : 'prod',
    env: 'dev',
    profileDir: profileDir,
    resourceDirName: 'resources',
    resourceDir: path.join(profileDir, 'resources'),
    tempDir: path.join(profileDir, 'tmp'),
    cacheDir: path.join(profileDir, 'cache'),
    pluginDataDir: path.join(profileDir, 'plugin-data'),
    pluginDir: path.join(profileDir, 'plugins'),
    templateDir: path.join(profileDir, 'templates'),
  };
  for (const [k, v] of Object.entries(settingConstants)) {
    Setting.setConstant(k, v);
  }

  // --- 4. 全 SyncTarget を SyncTargetRegistry に登録（Setting.metadata が全ターゲット名を参照するため）---
  SyncTargetRegistry.addClass(SyncTargetOneDrive);
  SyncTargetRegistry.addClass(SyncTargetDropbox);
  SyncTargetRegistry.addClass(SyncTargetFilesystem);
  SyncTargetRegistry.addClass(SyncTargetNextcloud);
  SyncTargetRegistry.addClass(SyncTargetWebDAV);
  SyncTargetRegistry.addClass(SyncTargetAmazonS3);
  SyncTargetRegistry.addClass(SyncTargetJoplinServer);

  // --- 5. 必要なディレクトリを確保 ---
  await fs.mkdirp(profileDir, 0o755);
  await fs.mkdirp(path.join(profileDir, 'resources'), 0o755);
  await fs.mkdirp(path.join(profileDir, 'tmp'), 0o755);
  await fs.mkdirp(path.join(profileDir, 'cache'), 0o755);

  // --- 6. ロガーの初期化 ---
  const globalLogger = new Logger();
  globalLogger.addTarget(TargetType.Console);
  globalLogger.setLevel(Logger.LEVEL_INFO);
  Logger.initializeGlobalLogger(globalLogger);
  reg.setLogger(Logger.create('') as unknown);

  // tsx のモジュール分離により Logger.ts インスタンスが別に存在する場合があるため、
  // require.cache 上の全 Logger インスタンスにも initializeGlobalLogger を伝播させる。
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || cached === Logger) continue;
    if (typeof cached.initializeGlobalLogger === 'function') {
      try {
        cached.initializeGlobalLogger(globalLogger);
      } catch (_) {
        /* ignore */
      }
    }
  }

  // tsx のモジュール分離により BaseService.ts インスタンスが別に存在する場合がある。
  // static logger_ フィールドを全インスタンスに伝播させる。
  const BaseService = require('@joplin/lib/services/BaseService').default;
  BaseService.logger_ = globalLogger;
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || cached === BaseService) continue;
    if (typeof cached !== 'object' && typeof cached !== 'function') continue;
    if ('logger_' in cached && cached.logger_ !== undefined) {
      try {
        cached.logger_ = globalLogger;
      } catch (_) {
        /* ignore */
      }
    }
  }

  // tsx のモジュール分離により BaseItem.ts インスタンスが別に存在する場合がある。
  // loadClass を全インスタンスに伝播させる（Synchronizer 内で使われる BaseItem が
  // sync_cli.ts の BaseItem インスタンスと異なるため）。
  const classMap: Record<string, unknown> = {
    Note,
    Folder,
    Resource,
    Tag,
    NoteTag,
    MasterKey,
    Revision,
  };
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || cached === BaseItem) continue;
    if (typeof cached.loadClass !== 'function') continue;
    for (const [name, cls] of Object.entries(classMap)) {
      try {
        cached.loadClass(name, cls);
      } catch (_) {
        /* ignore */
      }
    }
  }

  // --- 7. shim の初期化（HTTP/fetch などを有効化）---
  let keytar: unknown = null;
  try {
    keytar = shim.platformSupportsKeyChain() ? require(/* webpackIgnore: true */ 'keytar') : null;
  } catch (_e) {
    // keytar が利用できない場合はスキップ
  }
  let sharp: unknown = null;
  try {
    sharp = require(/* webpackIgnore: true */ 'sharp');
  } catch (_e) {
    // sharp は画像処理用。同期には必須ではないためスキップ可
  }
  shimInit(sharp, keytar, null, () => '0.0.1');

  // --- 8. データベースを開く ---
  const dbPath = path.join(profileDir, 'database.sqlite');
  console.log(`Opening database: ${dbPath}`);

  const db = new JoplinDatabase(new DatabaseDriverNode());
  db.setLogger(globalLogger);
  await db.open({ name: dbPath });

  reg.setDb(db);
  BaseModel.setDb(db);
  // tsx がソース .ts ファイルを直接ロードする場合、Setting.ts→BaseModel.ts が
  // BaseModel.js とは別のモジュールインスタンスになり db_ が共有されないため、
  // 各モデルクラスにも明示的に setDb を呼ぶ。
  Setting.setDb(db);
  Note.setDb(db);
  Folder.setDb(db);
  Resource.setDb(db);
  Tag.setDb(db);
  NoteTag.setDb(db);
  MasterKey.setDb(db);
  Revision.setDb(db);
  KvStore.instance().setDb(db);

  // RevisionService の初期化（Note.save() 内部で参照されるため必須）
  BaseItem.revisionService_ = RevisionService.instance();
  // tsx のモジュール分離で別インスタンスの BaseItem が存在する場合にも伝播
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || cached === BaseItem) continue;
    if (typeof cached !== 'object' && typeof cached !== 'function') continue;
    if ('revisionService_' in cached) {
      try {
        cached.revisionService_ = RevisionService.instance();
      } catch (_) {
        /* ignore */
      }
    }
  }

  // --- 9. キーチェーン＆設定の読み込み（sync.target, 認証情報などを DB から復元）---
  // loadKeychainServiceAndSettings をインライン化。
  // SettingUtils.js 内部の Setting が別モジュールインスタンスになる問題を回避する。
  const clientIdSetting = await Setting.loadOne('clientId');
  const clientId = clientIdSetting ? clientIdSetting.value : uuid.create();
  KeychainService.instance().initialize(
    new KeychainServiceDriver(Setting.value('appId'), clientId)
  );
  KeychainService.instance().setLogger(globalLogger);
  Setting.setKeychainService(KeychainService.instance());
  await Setting.load();

  // tsx のモジュールインスタンス分離により require.cache 上に複数の Setting/BaseModel が
  // 存在する場合がある。Setting.load() は主インスタンス（.js）にしか DB の値を読み込まないため、
  // 他のインスタンス（.ts 経由でロードされたもの）にも同じ初期化を行う必要がある。
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || typeof cached !== 'function') continue;

    // BaseModel 系: db を伝播（Setting.load() より前に必要）
    if (typeof cached.setDb === 'function') {
      try {
        cached.setDb(db);
      } catch (_) {
        /* ignore */
      }
    }

    if (typeof cached.cancelScheduleSave !== 'function') continue;
    // 以下は Setting インスタンスのみ
    if (cached === Setting) continue; // 主インスタンスはスキップ

    // autoSave を無効化してタイマークラッシュを防ぐ
    cached.autoSaveEnabled = false;

    // 定数を伝播（env 等が SET_ME のまま残るのを防ぐ）
    if (typeof cached.setConstant === 'function') {
      for (const [k, v] of Object.entries(settingConstants)) {
        try {
          cached.setConstant(k, v);
        } catch (_) {
          /* ignore */
        }
      }
    }

    // KeychainService を伝播
    if (typeof cached.setKeychainService === 'function') {
      try {
        cached.setKeychainService(KeychainService.instance());
      } catch (_) {
        /* ignore */
      }
    }

    // DB から設定を読み込む（auth トークン等を取得するために必要）
    if (typeof cached.load === 'function') {
      try {
        await cached.load();
      } catch (_) {
        /* ignore */
      }
    }

    // load() 後に発生したタイマーもキャンセル
    if (typeof cached.cancelScheduleSave === 'function') cached.cancelScheduleSave();
    if (typeof cached.cancelScheduleChangeEvent === 'function') cached.cancelScheduleChangeEvent();
  }

  // 主インスタンスのタイマーも無効化
  Setting.autoSaveEnabled = false;
  Setting.cancelScheduleSave();
  Setting.cancelScheduleChangeEvent();

  if (!clientIdSetting) Setting.setValue('clientId', clientId);
  await KeychainService.instance().detectIfKeychainSupported();

  // --- 9.5. profileDir/settings.json から sync 設定を上書き ---
  // settingsJsonPath と earlySettingsJson は Step 3 で先読み済み
  if (Object.keys(earlySettingsJson).length > 0) {
    const settingsJson = earlySettingsJson;
    const overrideKeys = ['sync.target', 'sync.useReverseProxy', 'sync.reverseProxyUrl'];

    // まず自分のインスタンスに反映
    for (const key of overrideKeys) {
      if (key in settingsJson) {
        Setting.setValue(key, settingsJson[key]);
      }
    }

    // tsx のモジュール分離により registry.ts が Setting.ts（別インスタンス）を
    // 参照しているため、require.cache 上の全 Setting インスタンスにも伝播させる。
    for (const cacheKey of Object.keys(require.cache)) {
      const cached = require.cache[cacheKey]?.exports?.default;
      if (!cached || typeof cached !== 'function') continue;
      if (cached === Setting) continue;
      if (typeof cached.setValue !== 'function') continue;
      for (const key of overrideKeys) {
        if (key in settingsJson) {
          try {
            cached.setValue(key, settingsJson[key]);
          } catch (_) {
            /* ignore */
          }
        }
      }
    }

    console.log(`Loaded settings overrides from: ${settingsJsonPath}`);
  }

  const syncTarget = Setting.value('sync.target');
  console.log(`Profile  : ${profileDir}`);
  console.log(`Sync target ID: ${syncTarget}`);

  // if (syncTarget !== SyncTargetOneDrive.id()) {
  //   throw new Error(
  //     `Error: このプロファイルの sync.target (${syncTarget}) は OneDrive (${SyncTargetOneDrive.id()}) ではありません。` +
  //       '\nOneDrive 以外のターゲットはサポートしていません。'
  //   );
  // }

  // --- 9.6. 診断情報のログ出力 ---
  {
    const { parameters: getParams } = require('@joplin/lib/parameters.js');
    const params = getParams();
    console.log(`[Debug] env               : ${Setting.value('env')}`);
    console.log(`[Debug] OneDrive client_id: ${params?.oneDrive?.id ?? '(not found)'}`);
  }

  const isAuthenticated = await reg.syncTarget().isAuthenticated();
  if (!isAuthenticated) {
    throw new Error(
      'Error: OneDrive が未認証です。Joplin Desktop / CLI で一度ログインしてください。'
    );
  }

  // --- 9.7. EncryptionService の初期化（sync 前に必要）---
  // serializeForSync() が暗号化を行うには BaseItem.encryptionService_ が必要。
  // また Synchronizer.start() 内部でも encryptionService() が参照される。
  const encService = EncryptionService.instance();
  encService.setLogger(globalLogger);
  BaseItem.encryptionService_ = encService;
  // tsx のモジュール分離により別インスタンスの BaseItem にも伝播
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || cached === BaseItem) continue;
    if (typeof cached !== 'object' && typeof cached !== 'function') continue;
    if ('encryptionService_' in cached) {
      try {
        cached.encryptionService_ = encService;
      } catch (_) {
        /* ignore */
      }
    }
  }
  // loadMasterKeysFromSettings() は内部で別インスタンスの Setting を参照するため
  // secure 設定 (encryption.passwordCache) を読めない場合がある。
  // sync_lib 側の Setting から直接パスワードキャッシュを取得してロードする。
  const masterKeys = await MasterKey.all();
  let passwords: Record<string, string> = Setting.value('encryption.passwordCache') || {};
  const activeMasterKeyId: string = Setting.value('encryption.activeMasterKeyId') || '';

  console.log(`[EncSetup] masterKeys: ${masterKeys.length}, passwordCache keys: ${JSON.stringify(Object.keys(passwords))}, activeMasterKeyId: ${activeMasterKeyId || '(empty)'}`);
  console.log(`[EncSetup] encryption.enabled: ${Setting.value('encryption.enabled')}, keytar available: ${!!shim.keytar()}`);
  if (masterKeys.length > 0) {
    console.log(`[EncSetup] masterKey IDs: ${masterKeys.map((mk: any) => mk.id).join(', ')}`);
  }

  // settings.json にパスワードキャッシュが指定されている場合は最優先で使用する。
  // OS keychain へのアクセス（security コマンド等）を回避できるため、
  // 複数 PC から同期する場合にダイアログが出ない利点がある。
  if (Object.keys(passwords).length === 0 && masterKeys.length > 0) {
    const jsonPasswords = earlySettingsJson['encryption.passwordCache'];
    if (jsonPasswords && typeof jsonPasswords === 'object') {
      passwords = jsonPasswords as Record<string, string>;
      console.log(`Loaded encryption.passwordCache from settings.json`);
    }
  }

  // パスワードキャッシュが空の場合、keychain から別の appId で読み込みを試みる。
  // プロファイルが desktop で作成されている場合、appId が異なる可能性があるため。
  if (Object.keys(passwords).length === 0 && masterKeys.length > 0 && shim.keytar()) {
    const fallbackAppIds = [
      'net.cozic.joplindev-desktop',
      'net.cozic.joplin-cli',
      'net.cozic.joplindev-cli',
    ];
    for (const fallbackAppId of fallbackAppIds) {
      try {
        const raw = await shim.keytar().getPassword(
          `${fallbackAppId}.setting.encryption.passwordCache`,
          `${clientId}@joplin`
        );
        if (raw) {
          passwords = typeof raw === 'string' ? JSON.parse(raw) : raw;
          console.log(`Loaded encryption.passwordCache from keychain (appId: ${fallbackAppId})`);
          break;
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  // keytar が利用できない場合（tsx/Node.js 環境）、macOS では security コマンドで
  // Keychain から直接パスワードキャッシュを読み込む。
  if (Object.keys(passwords).length === 0 && masterKeys.length > 0 && !shim.keytar() && process.platform === 'darwin') {
    const { execSync } = require('child_process');
    const appIdsToTry = [
      'net.cozic.joplin-desktop',
      'net.cozic.joplindev-desktop',
      'net.cozic.joplin-cli',
      'net.cozic.joplindev-cli',
    ];
    console.log(`[EncSetup] keytar unavailable, trying macOS security command (clientId: ${clientId})`);
    console.log(`[EncSetup] *** macOS Keychain のアクセス許可ダイアログが表示された場合は「常に許可」をクリックしてください ***`);
    for (const appIdToTry of appIdsToTry) {
      const serviceName = `${appIdToTry}.setting.encryption.passwordCache`;
      const accountName = `${clientId}@joplin`;
      try {
        const cmd = `security find-generic-password -s ${JSON.stringify(serviceName)} -a ${JSON.stringify(accountName)} -w`;
        console.log(`[EncSetup] Trying: ${cmd}`);
        const raw = execSync(cmd, { encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (raw) {
          console.log(`[EncSetup] Raw keychain value (first 80 chars): ${raw.substring(0, 80)}`);
          const allKeychainPasswords: Record<string, string> = JSON.parse(raw);
          // 当該プロファイルのマスターキーに該当するパスワードのみ採用する。
          // 他プロファイルのマスターキーのパスワードは含めない。
          const localMasterKeyIds = new Set(masterKeys.map((mk: any) => mk.id));
          const filteredPasswords: Record<string, string> = {};
          for (const [mkId, pw] of Object.entries(allKeychainPasswords)) {
            if (localMasterKeyIds.has(mkId)) {
              filteredPasswords[mkId] = pw;
            }
          }
          if (Object.keys(filteredPasswords).length > 0) {
            passwords = filteredPasswords;
            console.log(`Loaded encryption.passwordCache from macOS Keychain via security command (appId: ${appIdToTry}), filtered to ${Object.keys(filteredPasswords).length} local key(s)`);
            // settings.json に自動保存して次回以降 security コマンドを回避する（macOS のみ）
            if (process.platform === 'darwin') {
              try {
                const currentJson: Record<string, unknown> = fs.existsSync(settingsJsonPath)
                  ? fs.readJsonSync(settingsJsonPath)
                  : {};
                currentJson['encryption.passwordCache'] = filteredPasswords;
                fs.writeJsonSync(settingsJsonPath, currentJson, { spaces: '\t' });
                console.log(`[EncSetup] Saved encryption.passwordCache to settings.json (${Object.keys(filteredPasswords).length} key(s))`);
              } catch (saveErr: any) {
                console.warn(`[EncSetup] Failed to save passwordCache to settings.json: ${saveErr.message}`);
              }
            }
          }
          break;
        }
      } catch (secErr: any) {
        const msg = secErr.stderr ? secErr.stderr.toString().trim() : secErr.message;
        console.log(`[EncSetup] security command failed for ${appIdToTry}: ${msg}`);
      }
    }
  }

  console.log(`Trying to load ${masterKeys.length} master key(s), passwordCache has ${Object.keys(passwords).length} entry(ies).`);
  for (const mk of masterKeys) {
    const pw = passwords[mk.id];
    if (!pw) continue;
    if (encService.isMasterKeyLoaded(mk.id)) continue;
    try {
      await encService.loadMasterKey_(mk, pw, activeMasterKeyId === mk.id);
    } catch (e: any) {
      console.warn(`Cannot load master key ${mk.id}: ${e.message}`);
    }
  }

  // activeMasterKeyId が Setting に設定されていないが、マスターキーがロードされた場合は
  // 最初にロードされたキーをアクティブにする。
  if (encService.loadedMasterKeysCount() > 0) {
    let hasActiveKey = false;
    try {
      encService.activeMasterKeyId();
      hasActiveKey = true;
    } catch (_) {
      // activeMasterKeyId_ が未設定
    }
    if (!hasActiveKey) {
      const firstLoadedId = masterKeys.find((mk: any) => encService.isMasterKeyLoaded(mk.id))?.id;
      if (firstLoadedId) {
        encService.setActiveMasterKeyId(firstLoadedId);
        console.log(`Set active master key to: ${firstLoadedId}`);
      }
    }
  }

  if (encService.loadedMasterKeysCount() > 0) {
    console.log(`Loaded ${encService.loadedMasterKeysCount()} master key(s). Encryption is ready.`);
  }

  // --- 10. 同期実行（Sidebar の「同期」ボタンと同じコードパス）---
  console.log('Starting OneDrive sync...');

  // Synchronizer.dispatch は public なので上書きして SYNC_REPORT_UPDATE を捕捉する
  let lastReport: Record<string, unknown> = {};
  const syncTargetId = Setting.value('sync.target');
  const syncInstance = await reg.syncTarget(syncTargetId).synchronizer();

  // --- 9.8. synchronizer() が新たにモジュールをロードするため、EncryptionService と
  // BaseItem の伝播をもう一度実行する。BaseSyncTarget.synchronizer() は内部で
  // EncryptionService.instance() を呼ぶが、tsx モジュール分離により初期化済みの
  // encService とは別のシングルトンが使われている可能性がある。---

  // (a) EncryptionService のシングルトン (instance_) を全モジュールインスタンスに伝播
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || cached === EncryptionService) continue;
    if (typeof cached !== 'function') continue;
    if (typeof cached.instance === 'function' && 'instance_' in cached && cached !== encService) {
      // EncryptionService クラスかどうかを判定（instance_ 静的プロパティ + instance() メソッド +
      // METHOD_SJCL 定数を持つ）
      if ('METHOD_SJCL' in cached) {
        try {
          cached.instance_ = encService;
          console.log(`[EncService] Propagated initialized EncryptionService singleton to module: ${cacheKey.split('/').slice(-3).join('/')}`);
        } catch (_) {
          /* ignore */
        }
      }
    }
  }

  // (b) BaseItem.encryptionService_ を全モジュールインスタンスに再伝播
  //     （synchronizer() 呼び出しで新たにロードされた BaseItem にも適用）
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || cached === BaseItem) continue;
    if (typeof cached !== 'object' && typeof cached !== 'function') continue;
    if ('encryptionService_' in cached) {
      try {
        cached.encryptionService_ = encService;
      } catch (_) {
        /* ignore */
      }
    }
  }

  // (c) Synchronizer の encryptionService も明示的に上書き
  syncInstance.setEncryptionService(encService);

  console.log(`[EncService] activeMasterKeyId: ${encService.activeMasterKeyId_ || '(not set)'}, loadedKeys: ${encService.loadedMasterKeysCount()}`);

  const originalDispatch = syncInstance.dispatch;
  syncInstance.dispatch = (action: { type: string; report?: Record<string, unknown> }) => {
    if (action.type === 'SYNC_REPORT_UPDATE' && action.report) {
      lastReport = action.report;
    }
    originalDispatch(action);
  };

  try {
    await reg.scheduleSync(0);
    // Setting.autoSaveEnabled が false のため、setValue() による変更（delta カーソル等）が
    // DBに保存されない。明示的に saveAll() を呼んで永続化する。
    // tsx のモジュール分離により Synchronizer が使う Setting インスタンスが別物になるため、
    // require.cache 上の全 Setting インスタンスに対して saveAll() を呼ぶ。
    await Setting.saveAll();
    for (const cacheKey of Object.keys(require.cache)) {
      const cached = require.cache[cacheKey]?.exports?.default;
      if (!cached || cached === Setting) continue;
      if (typeof cached.saveAll !== 'function') continue;
      try {
        await cached.saveAll();
      } catch (_) {
        /* ignore */
      }
    }
  } catch (syncError: unknown) {
    const msg = syncError instanceof Error ? syncError.message : String(syncError);
    console.error(`[Sync Error] ${msg}`);
    // OneDrive API エラーレスポンスがある場合は詳細を表示
    if (syncError instanceof Error && (syncError as { responseText?: string }).responseText) {
      console.error(
        '[Sync Error] Response:',
        (syncError as { responseText?: string }).responseText
      );
    }
    throw syncError;
  } finally {
    syncInstance.dispatch = originalDispatch;
  }
  console.log('Sync finished.');

  // --- 10.5. 復号 → リソース取得 → 再復号 の3段階処理 ---
  // 暗号化が有効な場合、同期直後のメタデータは encryption_applied=1 のため
  // ResourceFetcher が needToBeFetched() でリソースを検出できない。
  // そこで:
  //   (1) DecryptionWorker でメタデータを復号 (encryption_applied=0 にする)
  //   (2) ResourceFetcher でリソース blob をダウンロード
  //   (3) DecryptionWorker で blob を復号 (encryption_blob_encrypted=0 にする)
  const fileApiFunc = async () => reg.syncTarget(syncTargetId).fileApi();
  const fetcher: typeof ResourceFetcher = ResourceFetcher.instance();
  fetcher.setFileApi(fileApiFunc);
  fetcher.setLogger(globalLogger);

  const runDecryption = async (label: string) => {
    if (encService.loadedMasterKeysCount() <= 0) {
      const hasMasterKeys = (await MasterKey.count()) > 0;
      if (hasMasterKeys) {
        console.warn('Master key(s) found but no password available in encryption.passwordCache. Encrypted items will not be decrypted.');
      }
      return 0;
    }
    console.log(`Starting decryption (${label})...`);
    const decWorker = DecryptionWorker.instance();
    decWorker.setLogger(globalLogger);
    decWorker.setEncryptionService(encService);
    decWorker.setKvStore(KvStore.instance());
    decWorker.dispatch = () => {};

    const decResult = await decWorker.start_({
      masterKeyNotLoadedHandler: 'dispatch',
      errorHandler: 'log',
    });

    if (decResult && decResult.error) {
      console.warn(`DecryptionWorker (${label}) finished with warning: ${decResult.error.message}`);
    } else {
      console.log(`Decryption (${label}) finished. Decrypted items: ${decResult?.decryptedItemCount ?? 0}`);
    }
    return decResult?.decryptedItemCount ?? 0;
  };

  // (1) メタデータ復号: encryption_applied=1 → 0 にして ResourceFetcher が検出可能にする
  await runDecryption('metadata');

  // (2) リソース blob ダウンロード
  console.log('Starting resource download...');
  await fetcher.fetchAll();
  await fetcher.waitForAllFinished();
  console.log('Resource download finished.');

  // (3) blob 復号: encryption_blob_encrypted=1 → 0 にしてファイルを利用可能にする
  await runDecryption('blob');

  const totalFolders: number = await Folder.count();
  const totalNotes: number = await Note.count();
  const totalResources: number = await Resource.count();
  const stats = reportToStats(lastReport, totalFolders, totalNotes, totalResources);

  // --- 11. 後処理 ---
  await fetcher.destroy();
  await reg.cancelTimers();

  return stats;
}
