# 用 ChatGPT 生成宠物资源

claude-pets 的每个 pet 都是一张 `1536×1872` 的 spritesheet（**8 列 × 9 行，每帧 192×208**），加一个 `pet.json` 描述文件。所有图都用 GPT Image 2（ChatGPT 网页版的图片生成）做。

## 标准 9 行（已有现成 skill）

不用手写 prompt——本机已经装好 **hatch-pet skill**（`~/.claude/skills/hatch-pet/`）。它会一步步生成每行的 prompt 让你贴进 ChatGPT，然后 Claude 处理拼图、验证、打包成最终 `spritesheet.webp` + `pet.json`，自动放到 `~/.claude/pets/`。

### 触发方式

在任何 Claude Code 会话里说：

```
帮我用 hatch-pet 做一个 pet：
名字 = <你想叫的名字>
描述 = <一句话，比如 "一只戴墨镜的橘黄色像素猫"，越具体越好>
风格参考（可选）= <参考图片路径>
```

Claude 会：
1. 跑 `prepare_pet_run.py` 生成 prompt 目录
2. 把 **基础角色 prompt** 给你（你贴 ChatGPT → 设置 1024×1024 → 拿图）
3. 顺序生成 9 行的 prompt（每行 prompt 都告诉你帧数、尺寸、还要附 base 图做 reference）
4. 你每出一张就丢给 Claude
5. 全部完成后自动跑 extract / compose / validate / QA，最后打包

**关键约束**（hatch-pet skill 都已经处理）：
- 透明背景（不能有任何底色 / drop shadow）
- 角色比例锁死在 base 图（每行都要附 base 做 reference）
- 8 帧横排，每帧 192×208，行图整体 1536×208（实际生图用 1792×1024，后续脚本会自动 crop）
- 风格 / 颜色 / 描边 / 笔触全部跟 base 一致

9 行分别是：
| 行 | 状态 | 用途 |
|---|---|---|
| 0 | idle | 静止呼吸 |
| 1 | running-right | 朝右跑 |
| 2 | running-left | 朝左跑（可由 right 镜像得到） |
| 3 | waving | 招手（用户提交 prompt 时） |
| 4 | jumping | 蹦一下（user 收到时短暂） |
| 5 | failed | 失败叹气 |
| 6 | waiting | 等待 |
| 7 | running | 运行工具 |
| 8 | review | 思考（review / thinking） |

按 hatch-pet 的 `SKILL.md` 流程走即可。

---

## D2 — 边缘吸附姿态（4 行新 row，需要手写 prompt）

pet 拖到屏幕边缘时切换的姿势。**这不是真的趴下睡觉**，而是**抓着屏幕边缘**——像扒在墙头、抓着栏杆——身体被边缘"截断"（屏幕外的部分不画），只有手 + 上半身/头露在屏幕内。视觉效果像偷偷探头看的小动物。

### 设计原则

- **跟 base 角色完全一致**：每次喂 ChatGPT 时**必须附上你之前生成的 base 图（canonical-base.png）作为 reference image**
- 同样的 8 帧/行，每帧 192×208，透明背景
- **构图关键**：身体下半段（或屏外的一侧）**完全不画**——直接被画面边缘 hard-crop，仿佛真的被屏幕边缘截断
- 每帧是一个完整的姿态变体（呼吸/微动 / 偶尔眨眼），不是大幅度动作

### Row 9 — 底部边缘吸附（clinging-bottom）

pet 在屏幕底边，**两只前爪扒着画面下沿，头和肩膀从下沿露出来**，像小狗偷看主桌的样子。

```
A 1792×1024 transparent PNG, 8 frames in one horizontal row, depicting <PET_DESCRIPTION> peeking up over a ledge.

Pose: the character is CLINGING to the BOTTOM edge of each frame. Only the HEAD, SHOULDERS, and TWO FRONT PAWS are visible — both paws gripping the very bottom edge of the frame as if holding onto a windowsill or table edge. The body BELOW the shoulders is OUTSIDE the frame (hard-cropped by the bottom border). Eyes look forward or slightly up, expression curious/peeking. Ears alert.

Composition: the visible silhouette occupies roughly the BOTTOM 40% of each frame; the upper 60% is empty transparent space. The two front paws are clearly anchored on the bottom edge, fingers/toes gripping over the edge.

The character's outline, color palette, fur/skin details, accessories and proportions must EXACTLY match the attached canonical-base.png reference.

Frame layout: 8 frames in a single row, each 224×1024 pixels (gpt-image-2 generates wide), evenly distributed left-to-right. Transparent background — no backdrop, no drop shadow, no visible ledge surface, no hands of another character. Only the pet and the implied invisible edge.

Subtle inter-frame variation only: tiny head bob, occasional eye blink (1-2 frames with eyes closed), micro ear twitch, slight paw grip adjustment. The character stays in the peeking pose throughout — never pulls itself up or drops down.
```

**ChatGPT 设置**：Size = `1792×1024` (Wide)，Quality = `high`，附上 `canonical-base.png`。
**保存为**：`<run-dir>/decoded/clinging-bottom.png`

### Row 10 — 左边缘吸附（clinging-left）

pet 在屏幕左边，**两爪扒在画面左沿，身体一半在屏外**，头从左侧露出朝右看。

```
A 1792×1024 transparent PNG, 8 frames in one horizontal row, depicting <PET_DESCRIPTION> clinging to a vertical edge from the LEFT side.

Pose: the character is gripping the LEFT edge of each frame with one or both front paws, head and partial torso poking out into the visible area. The body is rotated so the head faces RIGHT (looking into the frame). Most of the body (back, hindquarters, tail) is OUTSIDE the frame (hard-cropped by the left border). The visible silhouette looks like a peeking pose around a corner.

Composition: the visible silhouette occupies roughly the LEFT 35% of each frame; the right 65% is empty transparent space. Paws clearly gripping the left edge.

The character's outline, color palette, fur/skin details, accessories and proportions must EXACTLY match the attached canonical-base.png reference.

Frame layout: 8 frames in a single row, each 224×1024 pixels, evenly distributed left-to-right. Transparent background — no backdrop, no shadow, no wall.

Subtle inter-frame variation: small head tilt, ear twitch, eye blink. Same peeking pose throughout — the character does not climb out or fall back.
```

### Row 11 — 右边缘吸附（clinging-right）

镜像 row 10。如果你的 base 角色左右对称（没有不对称的标记 / 挂件 / 文字），让 Claude 跑镜像脚本即可：

```bash
python scripts/derive_running_left_from_running_right.py \
  --input decoded/clinging-left.png \
  --output decoded/clinging-right.png
```
（hatch-pet 现成脚本，沿用即可。）

不对称的话，按 row 10 prompt 把所有方向词反过来重新生成（head faces LEFT, body off-screen RIGHT, paws gripping right edge）。

### Row 12 — 顶部边缘吸附（clinging-top）

pet 在屏幕顶边，**两只前爪扒着画面上沿往下挂**，头朝下垂在画面里，像猫挂在橱柜顶上。

```
A 1792×1024 transparent PNG, 8 frames in one horizontal row, depicting <PET_DESCRIPTION> hanging by its paws from the TOP edge of each frame.

Pose: the character is gripping the TOP edge of each frame with both front paws, body hanging down into the frame. The HEAD is below the paws (so the character is oriented head-down or tilted, eyes looking forward/down). The TOP of the body — specifically the upper portion of the front paws/wrists — is OUTSIDE the frame (hard-cropped by the top border) as if reaching over a higher edge. Imagine a cat that hooked its paws over a high shelf and now hangs there.

Composition: the visible silhouette occupies the FULL VERTICAL extent of each frame, anchored at the top by the paws. Body weight pulls everything straight down. The expression is curious or mildly resigned — not distressed.

The character's outline, color palette, fur/skin details, accessories and proportions must EXACTLY match the attached canonical-base.png reference.

Frame layout: 8 frames in a single row, each 224×1024 pixels, evenly distributed left-to-right. Transparent background — no backdrop, no shadow, no rope, no shelf, no hand of another character.

Subtle inter-frame variation: gentle pendulum sway (≤5°), limbs drift, occasional eye blink. Identical hanging pose throughout — never pulls up, never falls.
```

---

## 拿到 4 张图后怎么贴到现有 pet

把 4 张原始 ChatGPT 出图（每张 1792×1024）放到你的 pet 目录下 `decoded/` 里：

```
~/.claude/pets/<my-pet>/
  pet.json
  spritesheet.webp        ← 现有 9 行
  decoded/
    clinging-bottom.png
    clinging-left.png
    clinging-right.png
    clinging-top.png
```

然后丢给 Claude：

```
我刚生了 4 张边缘姿态的图在 ~/.claude/pets/<my-pet>/decoded/，
帮我用 hatch-pet 的 extract_strip_frames.py + compose_atlas.py
把它们 crop 成 8 帧 × 192×208，append 到现有 spritesheet 后面变成
13 行（1536×2704），更新 pet.json，重新打包。
```

Claude 会用 hatch-pet 的现成脚本处理。

**注意**：pet 端代码（`usePetAnimation.ts`）目前 hardcoded 9 行（`SHEET_H=1872`）。加完 4 行后还需要：
- 在 `AnimState` 加 4 个新状态（`clinging-bottom` / `clinging-left` / `clinging-right` / `clinging-top`）
- 在 `usePetAnimation.ts` 加它们对应的 row index (9/10/11/12) 和 frame count
- 在 `PetWidget.tsx` 根据 `edgeProximity`（line 174 已经算好）切换到对应 state

我后续做 D2 时会一起改这部分。**你现在只需要把 4 张图生出来放好。**

---

## 常见错误

| 现象 | 原因 |
|---|---|
| pet 切到新行后整个变白 / 走形 | 没附 base 图做 reference，ChatGPT 自己脑补了一个不同的角色 |
| 每帧大小不一 / 角色在帧之间漂移 | prompt 漏了「8 frames evenly distributed」「same pose throughout」 |
| spritesheet 边缘有杂色 | ChatGPT 加了浅色背景。要在 prompt 里多次强调 "transparent background, no backdrop, no shadow" |
| 出图模糊 / 失真 | 选错了 size，必须是 `1792×1024 (Wide)` 不是 `1024×1024 (Square)` |
| 帧间动作太大 | prompt 里要明示 "subtle inter-frame variation only" + "same pose throughout" |
