/**
 * HTML エクスポートライブラリ
 *
 * Joplin のノートを HTML ファイルとしてエクスポートする。
 * InteropService.export() を利用し、app-desktop の「すべてをエクスポート → HTML」と
 * 同等の機能を CLI から実行できる。
 *
 * エントリポイント (export_html_cli.ts) から呼び出される。
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

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
const uuid = require('@joplin/lib/uuid').default;
const fs = require('fs-extra');
const ArrayUtils = require('@joplin/lib/ArrayUtils');
const fsExtra = require('fs-extra');

import { ExporterHtmlCli } from './ExporterHtmlCli';

// ---------------------------------------------------------------------------
// エクスポートオプション
// ---------------------------------------------------------------------------

export interface ExportHtmlOptions {
  /** 出力先ディレクトリの絶対パス */
  outputDir: string;
  /** 画像をBase64で埋め込むか (true: 埋め込み, false: リソースフォルダコピー) */
  embededImage: boolean;
}

// ---------------------------------------------------------------------------
// Joplin 環境初期化（sync_lib.ts と同パターン）
// ---------------------------------------------------------------------------

async function initJoplinEnv(profileDir: string): Promise<void> {
  // --- 1. FsDriver のセットアップ ---
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
  const settingsJsonPath = path.join(profileDir, 'settings.json');
  let earlySettingsJson: Record<string, unknown> = {};
  if (fs.existsSync(settingsJsonPath)) {
    try {
      earlySettingsJson = fs.readJsonSync(settingsJsonPath);
    } catch (_) {
      /* ignore */
    }
  }

  const settingConstants: Record<string, string> = {
    appId: 'net.cozic.joplin-cli',
    appType: 'cli',
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

  // --- 4. SyncTarget の登録（Setting.metadata が全ターゲット名を参照するため） ---
  SyncTargetRegistry.addClass(SyncTargetOneDrive);
  SyncTargetRegistry.addClass(SyncTargetDropbox);
  SyncTargetRegistry.addClass(SyncTargetFilesystem);
  SyncTargetRegistry.addClass(SyncTargetNextcloud);
  SyncTargetRegistry.addClass(SyncTargetWebDAV);
  SyncTargetRegistry.addClass(SyncTargetAmazonS3);
  SyncTargetRegistry.addClass(SyncTargetJoplinServer);

  // --- 5. 必要ディレクトリ確保 ---
  await fs.mkdirp(profileDir, 0o755);
  await fs.mkdirp(path.join(profileDir, 'resources'), 0o755);
  await fs.mkdirp(path.join(profileDir, 'tmp'), 0o755);
  await fs.mkdirp(path.join(profileDir, 'cache'), 0o755);

  // --- 6. ロガー初期化 ---
  const globalLogger = new Logger();
  globalLogger.addTarget(TargetType.Console);
  globalLogger.setLevel(Logger.LEVEL_INFO);
  Logger.initializeGlobalLogger(globalLogger);
  reg.setLogger(Logger.create('') as unknown);

  // tsx のモジュール分離対策: Logger を全インスタンスに伝播
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

  // tsx のモジュール分離で別インスタンスの BaseItem が存在する場合にも伝播
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

  // --- 7. shim の初期化 ---
  let keytar: unknown = null;
  try {
    keytar = shim.platformSupportsKeyChain() ? require('keytar') : null;
  } catch (_e) {
    // keytar が利用できない場合はスキップ
  }
  let sharp: unknown = null;
  try {
    sharp = require('sharp');
  } catch (_e) {
    // sharp は画像処理用。エクスポートには必須ではないためスキップ可
  }
  shimInit(sharp, keytar, null, () => '0.0.1');

  // tsx のモジュール分離対策: shimInit が初期化する shim と他モジュールが参照する
  // shim が別インスタンスになる場合があるため、FsDriverNode を全 shim に伝播する
  const fsDriverInstance = new FsDriverNode();
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || typeof cached !== 'object') continue;
    if (!('fsDriver' in cached) || !('fetchMaxRetry_' in cached)) continue;
    cached.fsDriver_ = fsDriverInstance;
    cached.fsDriver = () => fsDriverInstance;
  }

  // --- 8. データベースを開く ---
  const dbPath = path.join(profileDir, 'database.sqlite');
  console.log(`Opening database: ${dbPath}`);

  const db = new JoplinDatabase(new DatabaseDriverNode());
  db.setLogger(globalLogger);
  await db.open({ name: dbPath });

  reg.setDb(db);
  BaseModel.setDb(db);
  Setting.setDb(db);
  Note.setDb(db);
  Folder.setDb(db);
  Resource.setDb(db);
  Tag.setDb(db);
  NoteTag.setDb(db);
  MasterKey.setDb(db);
  Revision.setDb(db);
  KvStore.instance().setDb(db);

  // RevisionService 初期化
  BaseItem.revisionService_ = RevisionService.instance();
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

  // --- 9. キーチェーン＆設定の読み込み ---
  const clientIdSetting = await Setting.loadOne('clientId');
  const clientId = clientIdSetting ? clientIdSetting.value : uuid.create();
  KeychainService.instance().initialize(
    new KeychainServiceDriver(Setting.value('appId'), clientId)
  );
  KeychainService.instance().setLogger(globalLogger);
  Setting.setKeychainService(KeychainService.instance());
  await Setting.load();

  // tsx のモジュール分離対策: Setting を全キャッシュインスタンスに伝播
  for (const cacheKey of Object.keys(require.cache)) {
    const cached = require.cache[cacheKey]?.exports?.default;
    if (!cached || typeof cached !== 'function') continue;

    if (typeof cached.setDb === 'function') {
      try {
        cached.setDb(db);
      } catch (_) {
        /* ignore */
      }
    }

    if (typeof cached.cancelScheduleSave !== 'function') continue;
    if (cached === Setting) continue;

    cached.autoSaveEnabled = false;

    if (typeof cached.setConstant === 'function') {
      for (const [k, v] of Object.entries(settingConstants)) {
        try {
          cached.setConstant(k, v);
        } catch (_) {
          /* ignore */
        }
      }
    }

    if (typeof cached.setKeychainService === 'function') {
      try {
        cached.setKeychainService(KeychainService.instance());
      } catch (_) {
        /* ignore */
      }
    }

    if (typeof cached.load === 'function') {
      try {
        await cached.load();
      } catch (_) {
        /* ignore */
      }
    }

    if (typeof cached.cancelScheduleSave === 'function') cached.cancelScheduleSave();
    if (typeof cached.cancelScheduleChangeEvent === 'function') cached.cancelScheduleChangeEvent();
  }

  Setting.autoSaveEnabled = false;
  Setting.cancelScheduleSave();
  Setting.cancelScheduleChangeEvent();

  if (!clientIdSetting) Setting.setValue('clientId', clientId);
  await KeychainService.instance().detectIfKeychainSupported();

  // settings.json からの設定上書き
  if (Object.keys(earlySettingsJson).length > 0) {
    const overrideKeys = ['sync.target', 'sync.useReverseProxy', 'sync.reverseProxyUrl'];
    for (const key of overrideKeys) {
      if (key in earlySettingsJson) {
        Setting.setValue(key, earlySettingsJson[key]);
      }
    }
    for (const cacheKey of Object.keys(require.cache)) {
      const cached = require.cache[cacheKey]?.exports?.default;
      if (!cached || typeof cached !== 'function') continue;
      if (cached === Setting) continue;
      if (typeof cached.setValue !== 'function') continue;
      for (const key of overrideKeys) {
        if (key in earlySettingsJson) {
          try {
            cached.setValue(key, earlySettingsJson[key]);
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// エクスポート実行
// ---------------------------------------------------------------------------

/**
 * 指定プロファイルの全ノートを HTML としてエクスポートする。
 *
 * @param profileDir Joplin プロファイルの絶対パス（例: ~/.config/joplin-desktop）
 * @param options エクスポートオプション
 */
async function preparePluginAssets(): Promise<void> {
  const publicDir = path.resolve(__dirname, '../public');
  const pluginAssetsDir = path.join(publicDir, 'pluginAssets');
  let rendererAssetsDir = path.resolve(__dirname, '../../node_modules/@joplin/renderer/assets');
  if (!fs.existsSync(rendererAssetsDir)) {
    rendererAssetsDir = path.resolve(
      __dirname,
      '../../../lib/node_modules/@joplin/renderer/assets'
    );
  }
  if (!fs.existsSync(rendererAssetsDir)) {
    console.warn(`@joplin/renderer/assets not found, skipping pluginAssets preparation`);
    return;
  }
  await fs.mkdirp(publicDir);
  await fs.remove(pluginAssetsDir);
  await fs.copy(rendererAssetsDir, pluginAssetsDir);
  console.log(`pluginAssets prepared: ${pluginAssetsDir}`);
}

export async function runExportHtml(profileDir: string, options: ExportHtmlOptions): Promise<void> {
  await initJoplinEnv(profileDir);

  console.log(`Output dir     : ${options.outputDir}`);
  console.log(`Embed images   : ${options.embededImage}`);
  console.log(`Profile dir    : ${profileDir}`);

  // public/pluginAssets を @joplin/renderer/assets から再構築する
  await preparePluginAssets();

  const resourcePath = `${Setting.value('resourceDir')}`;
  const exportPath = options.outputDir;
  const warnings: string[] = [];

  // --- 1. エクスポーターの初期化 ---
  const exporter = new ExporterHtmlCli();
  await exporter.init(exportPath, {
    embededImage: options.embededImage,
  });

  // --- 2. エクスポート対象の収集 ---
  const folderIds: string[] = await Folder.childrenIds('');
  const itemsToExport: any[] = [];
  const exportedNoteIds: string[] = [];
  let resourceIds: string[] = [];

  for (const folderId of folderIds) {
    itemsToExport.push({ type: BaseModel.TYPE_FOLDER, itemOrId: folderId });
    const noteIds: string[] = await Folder.noteIds(folderId);
    for (const noteId of noteIds) {
      const note = await Note.load(noteId);
      if (!note) continue;
      itemsToExport.push({ type: BaseModel.TYPE_NOTE, itemOrId: note });
      exportedNoteIds.push(noteId);
      const rids = await Note.linkedResourceIds(note.body);
      resourceIds = resourceIds.concat(rids);
    }
  }
  resourceIds = ArrayUtils.unique(resourceIds);
  for (const rid of resourceIds) {
    itemsToExport.push({ type: BaseModel.TYPE_RESOURCE, itemOrId: rid });
  }

  // --- 3. リソースフォルダのコピー ---
  const resourceFolder = path.basename(resourcePath);
  const exportResourcePath = path.join(exportPath, resourceFolder);
  const profileDirPath = `${Setting.value('profileDir')}`;
  if (exportResourcePath.indexOf(profileDirPath) !== 0) {
    fsExtra.copySync(resourcePath, exportResourcePath, { overwrite: true });
  }

  // --- 4. アイテムの処理（リソース → フォルダ → ノートの順） ---
  const typeOrder = [BaseModel.TYPE_FOLDER, BaseModel.TYPE_RESOURCE, BaseModel.TYPE_NOTE];
  const context: any = { resourcePaths: {} };
  const targetItems: any[] = [];

  for (const typeVal of typeOrder) {
    for (const entry of itemsToExport) {
      if (entry.type !== typeVal) continue;
      const itemOrId = entry.itemOrId;
      let item: any;
      if (typeof itemOrId === 'object') {
        item = itemOrId;
      } else {
        const ItemClass = BaseItem.getClassByItemType(entry.type);
        item = await ItemClass.load(itemOrId);
      }
      if (!item) {
        warnings.push(`Cannot find item: ${JSON.stringify(itemOrId)}`);
        continue;
      }
      if (item.encryption_applied || item.encryption_blob_encrypted) {
        warnings.push(`Encrypted item skipped: ${item.title || item.id}`);
        continue;
      }
      targetItems.push(item);
    }
  }

  // --- 5. noteId → HTML パスのマッピングを作成 ---
  const noteIdToPath: { [key: string]: string } = {};
  for (const item of targetItems) {
    if (item.type_ === BaseModel.TYPE_NOTE) {
      const htmlPath = await exporter.createHtmlPath(item);
      noteIdToPath[item.id] = htmlPath;
    }
  }
  for (const item of targetItems) {
    if (item.type_ === BaseModel.TYPE_NOTE) {
      item.noteIdToPath = noteIdToPath;
    }
  }

  // --- 6. 各アイテムをエクスポート ---
  for (const item of targetItems) {
    try {
      if (item.type_ === BaseModel.TYPE_RESOURCE) {
        const resPath = Resource.fullPath(item);
        context.resourcePaths[item.id] = resPath;
        exporter.updateContext(context);
        await exporter.processResource(item, resPath);
      }
      await exporter.processItem(item);
    } catch (error: any) {
      console.error(error);
      warnings.push(error.message);
    }
  }

  await exporter.close();

  if (warnings.length > 0) {
    console.warn('Export warnings:');
    for (const w of warnings) {
      console.warn(`  - ${w}`);
    }
  }

  console.log('Export finished.');
}
