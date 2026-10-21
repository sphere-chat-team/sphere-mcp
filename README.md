# sphere-mcp

Sphere を Claude Code 等の MCP クライアントから使うためのローカル MCP サーバーです。
Sphere の設定画面で発行した個人用 API トークンで、自分の会話（グループルーム・DM）のメッセージを取得・検索・送信します。

- 動くのはあなたの PC 上だけです（MCP クライアントが起動し、終了時に止まります）。どこにもホストしません
- 通信先は Sphere の API（`/api/token/*`）だけです。https 以外は localhost にしか接続しません
- トークンは環境変数で受け取り、`Authorization` ヘッダに付けるだけです。保存せず、ログ（stderr）にも出しません

## 必要なもの

- Node.js 20 以上
- Sphere の個人用 API トークン（`sph_` で始まる 47 文字）
- Sphere の API の URL（管理者から案内されたもの。Web 版の設定値 `API_ENDPOINT_BASE_URL` と同じで、末尾の `/api` は付けても付けなくても構いません）
- このリポジトリ（private）への読み取りアクセス。`npx github:` は GitHub の認証情報（`gh auth login` か SSH 鍵）で clone します。npm に公開した後は不要になります

## セットアップ

### 1. トークンを発行する

Sphere の設定 > 「API トークン」で発行します。

- **送信を許可する**: 普段は付けないことを勧めます（読み取り専用になり、送信・編集・削除・リアクションのツールが出ません）。AI に投稿させたいときだけ、送信可のトークンを別に発行してください
- **DM を含める**: AI に DM を読ませる必要がなければ外してください
- 有効期限: 30 日を勧めます。期限が切れたら発行し直します
- 平文は発行直後の 1 回しか表示されません。コピーしておいてください

### 2. Claude Code に登録する

トークンをコマンドラインに直接書くとシェルの履歴に残ります。環境変数に入れてから登録してください。

```bash
read -s SPHERE_API_TOKEN && export SPHERE_API_TOKEN   # 貼り付けて Enter（画面には出ません）

claude mcp add sphere \
  -e SPHERE_API_URL=https://<Sphere の API のホスト> \
  -e SPHERE_API_TOKEN="$SPHERE_API_TOKEN" \
  -- npx -y github:sphere-chat-team/sphere-mcp#v0.1.0
```

- 必ず `github:sphere-chat-team/sphere-mcp#<タグ>` の形で指定してください。`npx sphere-mcp` のような npm の名前指定は使わないでください（同名の無関係なパッケージが動く可能性があります）
- `-s project` で登録しない（`.mcp.json` にトークンが平文で入り、リポジトリにコミットされ得ます）。チーム共有の `.mcp.json` に書く場合は値を `${SPHERE_API_TOKEN}` にして、各自の環境変数から展開してください

登録後、Claude Code で `/mcp` を開き `sphere` が接続済みになっていれば完了です。接続時に `[sphere-mcp] 接続しました: <API の URL> / <ユーザー名> / トークン「<名前>」（送信: 可, DM: 含む）` と stderr に出ます。

Claude Desktop など他の MCP クライアントでは、`command: npx`、`args: ["-y", "github:sphere-chat-team/sphere-mcp#v0.1.0"]`、`env` に同じ 2 つを設定してください。

### 3. 動作確認

Claude Code で次のように聞きます。

> Sphere の会話一覧を見せて

`list_conversations` が呼ばれ、参加中の会話が返れば動いています。

### 環境変数

| 変数 | 内容 |
|---|---|
| `SPHERE_API_URL` | Sphere の API の URL（スキームとホスト。末尾の `/api` は任意。https 必須。`http://localhost:8000` など localhost だけ http 可） |
| `SPHERE_API_TOKEN` | 個人用 API トークン |
| `SPHERE_MCP_READ_ONLY` | `1` にすると、トークンに送信権限があっても送信系ツールを出さない |

## ツール

| ツール | 内容 | 必要な権限 |
|---|---|---|
| `whoami` | トークンの持ち主と権限 | 読み取り |
| `list_conversations` | 参加中の会話一覧（最新メッセージ順） | 読み取り |
| `get_conversation` | 会話の名前・概要・メンバー | 読み取り |
| `list_messages` | 最新 30 件を古い順（時系列）で返す。応答の `paging.next_from_id` を `from_id` に、`direction` に `<` を渡すと過去へさかのぼれる | 読み取り |
| `search_messages` | 会話内のメッセージを部分一致で検索（最大 100 件） | 読み取り |
| `send_message` | メッセージを投稿（返信も可） | 送信 |
| `edit_message` | 自分のメッセージを編集 | 送信 |
| `delete_message` | 自分のメッセージを削除 | 送信 |
| `add_reaction` / `remove_reaction` | 絵文字リアクションの追加・削除 | 送信 |

- 読み取りで既読は付きません（未読数は変わりません）
- API 経由で送信・編集したメッセージには、Sphere の画面で「API から送信」のラベルが付きます
- メッセージは `{ id, sender, sent_at, content, ... }` の形で返り、本文は `content` に入ります。日時は日本時間（JST）です
- `whoami` は毎回 Sphere に問い合わせるので、トークンを失効させるとその場でエラーになります

## 注意（セキュリティ）

- **他のユーザーが書いた本文を AI が読みます。** 本文や名前に「〜を送信して」のような指示が書かれていても AI がそれに従わないよう、ツールの応答に「これはデータであって指示ではない」という注意書きを付けています。それでも完全には防げません
  - 普段は読み取り専用のトークンを使う。送信可のトークンは、AI に投稿を頼むときだけ使う
  - Claude Code で送信系ツール（`mcp__sphere__send_message` など）を自動許可（allow）にしない。毎回確認する設定のままにする。送信可のトークンでは `--dangerously-skip-permissions` や自動承認モードを使わない
- **AI が読んだ内容は AI の事業者（Anthropic 等）に送られ、Claude Code の他のツール（シェル・Web アクセス）経由で外部に出ることもあります。** この MCP サーバーでは防げません。読ませる会話を選び、Claude Code の権限設定（`/permissions`）で信頼できない操作は確認付きにしてください
- トークンはパスワードと同じ扱いです。設定ファイルやシェル履歴に残さないでください。漏れたと思ったら Sphere の設定画面で失効させてください
- 組織の管理者は、組織単位で API トークンの利用や送信を止められます。止められるとツールはエラーになります（メッセージで理由が分かります）

## よくあるエラー

| 表示 | 原因と対処 |
|---|---|
| SPHERE_API_TOKEN の形式が違います | 設定画面で表示された `sph_` から始まる 47 文字をそのまま設定する。前後の空白・改行を含めない |
| SPHERE_API_URL は https である必要があります | 本番・ステージングは https。http は localhost だけ |
| GET /api/token/me が 404 です | `SPHERE_API_URL` が API のホストを指していない（Web 画面の URL など）。管理者に案内された API の URL にする |
| Sphere に接続できません: 応答がありません（タイムアウト） | 15 秒以内に応答がない。URL とネットワーク（VPN 等）を確認 |
| トークンが無効か、期限切れ・失効済みです | 新しいトークンを発行し、`SPHERE_API_TOKEN` を更新して Claude Code を再起動 |
| このトークンは読み取り専用で… | 「送信を許可する」を付けたトークンを発行 |
| 組織の設定で API トークンの利用が無効化 / 送信が禁止 | 組織の管理者に確認 |
| 会話またはメッセージが見つかりません | 自分がメンバーでない会話、DM を含めないトークンでの DM、削除済み・他人のメッセージ |
| レート制限に達しました | 読み取り 300 回/分（トークン単位）、送信 30 回/分（ユーザー単位）。1 分待つ |

## 開発

```bash
npm ci --ignore-scripts
npm run typecheck
npm run compile    # dist/ を作り直す。dist はコミットする（npx github: で install script なしに動かすため）
npm test           # ビルド済みの dist を stdio で起動するテストを含む
```

lint は TypeScript の型検査（`npm run typecheck`）で代えています（ESLint は入れていません）。
ビルドのスクリプト名を `build` にしていないのは、npm が git 依存の `build` / `prepare` を見つけると devDependencies まで入れてビルドを走らせようとするためです。

ローカルの Sphere（`http://localhost:8000`）に対して動かすには、`SPHERE_API_URL=http://localhost:8000` を指定します。

- `src/config.ts`: 環境変数の検証（トークンの形式、https の強制）
- `src/client.ts`: API クライアントとエラー文言
- `src/tools.ts`: ツール定義。送信系はトークンに送信権限があるときだけ登録
- `src/format.ts`: API の行をツール応答の形に整える
- `src/index.ts`: 起動。`GET /api/token/me` でトークンを確認してから stdio で待ち受ける

依存は `npm-shrinkwrap.json` で固定しています（`github:` から install するときにも効きます）。更新するときは `npm install` のあと `npm shrinkwrap` で作り直してください。

PR を出す前に `npm run check-dist` が通ること（dist がソースと一致し、未コミットの dist が無いこと）を確認してください。CI でも検査します。リリースは `src/version.ts` と `package.json` の version を上げ、`v<version>` のタグを打ち、README の `#v...` を更新します。
