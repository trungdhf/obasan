# Asset attribution — `web/models/`

Nguồn gốc và license của toàn bộ model (.vrm) và motion clip (.vrma) dùng trong
app Hinata. Tất cả đều là asset miễn phí / sample chính thức; không dùng asset
trả phí hay cần đăng nhập BOOTH.

## Models (.vrm)

| File | Nội dung | Nguồn | License |
|---|---|---|---|
| `hinata.vrm` | Hinata (current avatar) | Sample model `three-vrm-girl.vrm` của pixiv, repo [pixiv/three-vrm](https://github.com/pixiv/three-vrm) (`packages/three-vrm/examples/models/`) | MIT (theo repo three-vrm) — model mẫu chính thức của pixiv cho VRM |
| `neko.vrm` | WeirdCat (alternative avatar) | Polygonal Mind — bộ **100Avatars R3**, registry [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars) | **CC0** (public domain, no attribution required) |

## Motion clips (.vrma)

### Nhóm A — vrm-viewer VRMA sample set (UniGLTF-2.51.0, shared skeleton)

`clapping.vrma`, `goodbye.vrma`, `jump.vrma`, `look_around.vrma`,
`surprised.vrma`, `thinking.vrma`

- Nguồn: [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer) —
  thư mục `VRMA/` (free sample motions, e.g. `Clapping.vrma`, `Thinking.vrma`)
- License: sample miễn phí đi kèm repo (dùng cho demo/testing VRM)

### Nhóm B — VRoid motion samples (UniGLTF-2.53.0)

`hello.vrma`, `motion_pose.vrma`

- Nguồn: bộ motion sample dạng VRM/Vroid-compatible (UniGLTF export)
- License: free sample, phân phối kèm viewer/demo

### Nhóm C — clip xuất qua three.js (THREE.GLTFExporter)

`greeting.vrma`, `greeting2.vrma`, `model_pose.vrma`, `peace_sign.vrma`,
`show_full_body.vrma`, `spin.vrma`

- Nguồn: motion data cho **VRoid Hub Playground** (pixiv — motion mẫu chính
  thức phát hành miễn phí để dùng trong playground), export lại sang .vrma qua
  three.js GLTFExporter
- License: sample data miễn phí của pixiv/VRoid

### Nhóm D — tự tạo

`greet_wave.vrma`

- Nguồn: clip vẫy tay tự retarget/export bằng **Blender + VRM Add-on** trong
  project này (không lấy từ nguồn ngoài)
- License: asset của chính repo này

## Ghi chú

- `hinata.vrm` là model sample placeholder của pixiv — nếu muốn đổi sang model
  riêng, export từ VRoid Studio và thay file + cập nhật bảng trên.
- Trang BOOTH từng được tham khảo khi tìm motion (maronvtuber, plustic777) —
  cuối cùng **không dùng** asset BOOTH nào trong app.
