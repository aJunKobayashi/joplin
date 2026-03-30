export class Config {
  public static readonly searchNoteLimit = 30;
  public static readonly renderWaitTimeoutMs = 10_000;
  public static readonly stableMs = 100;
  public static readonly useProxy = false; // Agentが通信にProxyを使用する場合はtrue、しない場合はfalse

  /** 画像圧縮ダイアログを表示するファイルサイズの閾値 (KB) */
  public static readonly imageCompressThresholdKB = 200;
  /** 圧縮後のデフォルト画像幅 (px) */
  public static readonly imageCompressDefaultWidth = 1000;
  /** 圧縮後のデフォルト最大画像サイズ (KB) */
  public static readonly imageCompressDefaultMaxSizeKB = 100;

  /**
   * Markdown インポート時に画像を取り込むフォルダ名（ホームディレクトリ直下）。
   * 例: 'joplin_img' → ~/joplin_img/
   */
  public static readonly importImgDir = 'joplin_img';

  /**
   * Markdown インポート時に画像を自動的に WebP 圧縮するかどうか。
   * false の場合はダイアログでオプションを選択しても圧縮フォームのデフォルトが無効になる。
   */
  public static readonly importImgCompress = true;
}
