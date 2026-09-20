<script lang="ts">
  import '../app.css'

  const { children } = $props()
</script>

<div class="min-h-dvh bg-surface text-ink">
  {@render children?.()}
</div>
